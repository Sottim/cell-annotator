import h3
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from pymongo.errors import PyMongoError
import pymongo
from dotenv import load_dotenv
import os
from flask import jsonify, request
# Load environment variables
load_dotenv()

# MongoDB setup
mongo_uri = os.getenv("MONGO_URI")
if not mongo_uri:
    raise ValueError("MONGO_URI not found in environment variables.")

client = MongoClient(mongo_uri, server_api=ServerApi('1'))
db = client.annotationsDB
geojson_collection = db.geojson_annotations
hexbin_collection = db.geojson_hex_bins

def compute_hexagons_for_all_documents(resolutions):
    documents = geojson_collection.find()

    if geojson_collection.count_documents({}) == 0:
        raise ValueError("No documents found in geojson_annotations collection.")

    for doc in documents:
        dzi_file = doc.get("dzi_file")
        if not dzi_file:
            print("Skipping document without a DZI file.")
            continue

        geojson_array = doc["geojson"]
        image_width = doc["image_width"]
        image_height = doc["image_height"]

        print(f"Processing {dzi_file}...")

        for resolution in resolutions:
            hex_bins = {}

            # Iterate through each feature in the geojson array
            for feature in geojson_array:
                geometry = feature.get("geometry")
                if not geometry:
                    continue

                feature_id = feature.get("id")
                if not feature_id:
                    print("Skipping feature without an ID.")
                    continue

                # Extract classification and color
                properties = feature.get("properties", {})
                classification = properties.get("classification", {}).get("name", "Unknown")
                color = properties.get("classification", {}).get("color", [255, 255, 255])  # Default to white

                # Handle Point and MultiPoint geometries
                if geometry["type"] == "Point" or geometry["type"] == "MultiPoint":
                    coordinates = geometry["coordinates"]
                    if geometry["type"] == "Point":
                        coordinates = [coordinates]  # Wrap single point in a list

                    for x, y in coordinates:
                        lat, lon = normalize_to_lat_lon(x, y, image_width, image_height)
                        hex_id = h3.latlng_to_cell(lat, lon, resolution)
                        add_to_hex_bins(hex_bins, hex_id, feature_id, classification, color)

                # Handle Polygon and MultiPolygon geometries
                elif geometry["type"] in ["Polygon", "MultiPolygon"]:
                    polygons = geometry["coordinates"]
                    if geometry["type"] == "Polygon":
                        polygons = [polygons]  # Wrap single polygon in a list

                    for polygon in polygons:
                        for ring in polygon:  # Each ring is a list of [x, y]
                            for x, y in ring:
                                lat, lon = normalize_to_lat_lon(x, y, image_width, image_height)
                                hex_id = h3.latlng_to_cell(lat, lon, resolution)
                                add_to_hex_bins(hex_bins, hex_id, feature_id, classification, color)

                else:
                    print(f"Skipping unsupported geometry type: {geometry['type']}")

            print(f"Resolution {resolution}: Generated {len(hex_bins)} hex bins for {dzi_file}.")

            # Batch insert transformed hex bins into MongoDB
            bulk_operations = []
            for hex_id, hex_data in hex_bins.items():
                hex_boundary = h3.cell_to_boundary(hex_id)

                # Convert hex boundary lat/lon back to image coordinates
                image_coordinates = [
                    lat_lon_to_image_coordinates(lat, lon, image_width, image_height)
                    for lat, lon in hex_boundary
                ]

                bulk_operations.append(
                    pymongo.InsertOne({
                        "dzi_file": dzi_file,
                        "hex_id": hex_id,
                        "feature_ids": list(set(hex_data["feature_ids"])),
                        "annotation_count": hex_data["annotation_count"],
                        "resolution": resolution,
                        "image_coordinates": image_coordinates,  # Store image coordinates
                        "classifications": hex_data["classifications"],  # Store classifications with colors
                    })
                )

            if bulk_operations:
                try:
                    hexbin_collection.bulk_write(bulk_operations)
                except Exception as e:
                    print(f"Error during bulk write: {e}")

    print("Hexagon computation complete for all documents.")

def add_to_hex_bins(hex_bins, hex_id, feature_id, classification, color):
    """
    Add data to hex_bins, updating the annotation count and classifications.
    """
    if hex_id not in hex_bins:
        hex_bins[hex_id] = {
            "feature_ids": [],
            "annotation_count": 0,
            "classifications": {},  # Store classifications with their colors
        }
    hex_bins[hex_id]["feature_ids"].append(feature_id)
    hex_bins[hex_id]["annotation_count"] += 1

    # Update classification counts with color
    if classification not in hex_bins[hex_id]["classifications"]:
        hex_bins[hex_id]["classifications"][classification] = {
            "count": 0,
            "color": color,
        }
    hex_bins[hex_id]["classifications"][classification]["count"] += 1

def normalize_to_lat_lon(x, y, image_width, image_height):
    """
    Normalize raw image coordinates (x, y) to pseudo-latitude and longitude.
    """
    normalized_x = x / image_width  # Scale x to 0-1
    normalized_y = y / image_height  # Scale y to 0-1

    latitude = normalized_y * 180 - 90  # Map to -90 to +90
    longitude = normalized_x * 360 - 180  # Map to -180 to +180

    return latitude, longitude

def lat_lon_to_image_coordinates(lat, lon, image_width, image_height):
    """
    Convert latitude and longitude to raw image coordinates.
    """
    x = ((lon + 180) / 360) * image_width
    y = ((lat + 90) / 180) * image_height
    return x, y

def get_hex_bins():
    try:
        data = request.json
        dzi_file = data.get("dzi_file")
        resolution = data.get("resolution")

        if not dzi_file or not resolution:
            return jsonify({"error": "dzi_file and resolution are required"}), 400

        # Query MongoDB for the hex bins, including image_coordinates and classifications
        hex_bins = list(hexbin_collection.find(
            {"dzi_file": dzi_file, "resolution": int(resolution)},
            {"_id": 0, "hex_id": 1, "annotation_count": 1, "feature_ids": 1, "image_coordinates": 1, "classifications": 1}
        ))

        return jsonify({"hex_bins": hex_bins})

    except PyMongoError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

if __name__ == "__main__":
    # Define the H3 resolutions to process
    resolutions = [2]

    try:
        compute_hexagons_for_all_documents(resolutions)
    except Exception as e:
        print(f"Error: {e}")
