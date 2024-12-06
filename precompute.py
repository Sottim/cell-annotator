import h3
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from pymongo.errors import PyMongoError
import pymongo
from gridfs import GridFS
from dotenv import load_dotenv
import os
import json

# Load environment variables
load_dotenv()

# MongoDB setup
mongo_uri = os.getenv("MONGO_URI")
if not mongo_uri:
    raise ValueError("MONGO_URI not found in environment variables.")

client = MongoClient(mongo_uri, server_api=ServerApi('1'))
db = client.annotationsDB
hexbin_collection = db.geojson_hex_bins
grid_fs = GridFS(db)

def process_geojson(dzi_file, geojson_data, image_width, image_height, resolutions):
    """
    Process GeoJSON data to compute hexagons and store them in the hexbin collection.
    """
    for resolution in resolutions:
        hex_bins = {}

        for feature in geojson_data:
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

            if geometry["type"] == "Point" or geometry["type"] == "MultiPoint":
                coordinates = geometry["coordinates"]
                if geometry["type"] == "Point":
                    coordinates = [coordinates]

                for x, y in coordinates:
                    lat, lon = normalize_to_lat_lon(x, y, image_width, image_height)
                    hex_id = h3.latlng_to_cell(lat, lon, resolution)
                    add_to_hex_bins(hex_bins, hex_id, feature_id, classification, color)

            elif geometry["type"] in ["Polygon", "MultiPolygon"]:
                polygons = geometry["coordinates"]
                if geometry["type"] == "Polygon":
                    polygons = [polygons]

                for polygon in polygons:
                    for ring in polygon:
                        for x, y in ring:
                            lat, lon = normalize_to_lat_lon(x, y, image_width, image_height)
                            hex_id = h3.latlng_to_cell(lat, lon, resolution)
                            add_to_hex_bins(hex_bins, hex_id, feature_id, classification, color)

        print(f"Resolution {resolution}: Generated {len(hex_bins)} hex bins for {dzi_file}.")

        # Batch insert hex bins into MongoDB
        bulk_operations = []
        for hex_id, hex_data in hex_bins.items():
            hex_boundary = h3.cell_to_boundary(hex_id)
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
                    "image_coordinates": image_coordinates,
                    "classifications": hex_data["classifications"],
                })
            )

        if bulk_operations:
            try:
                hexbin_collection.bulk_write(bulk_operations)
            except Exception as e:
                print(f"Error during bulk write: {e}")

def compute_hexagons_for_specific_file_and_dzi(resolutions, filename, dzi_file):
    """
    Compute hexagons for a specific document in GridFS identified by metadata.filename and metadata.dzi_file.
    """
    # Find the specific file document in GridFS
    file_doc = db.fs.files.find_one({"metadata.filename": filename, "metadata.dzi_file": dzi_file})

    if not file_doc:
        print(f"File with metadata.filename '{filename}' and metadata.dzi_file '{dzi_file}' not found in GridFS.")
        return

    file_id = file_doc.get("_id")

    if not file_id:
        print("Skipping incomplete file document in GridFS.")
        return

    # Retrieve the file content from GridFS
    try:
        file_data = grid_fs.get(file_id).read()
        geojson_data = json.loads(file_data)
    except Exception as e:
        print(f"Error reading file from GridFS: {e}")
        return

    # Extract image dimensions from metadata
    metadata = file_doc.get("metadata", {})
    image_width = metadata.get("image_width")
    image_height = metadata.get("image_height")

    if not (image_width and image_height):
        print(f"Skipping file {filename} due to missing image dimensions.")
        return

    # Process GeoJSON data
    process_geojson(dzi_file, geojson_data, image_width, image_height, resolutions)

    print(f"Hexagon computation complete for file '{filename}' with DZI file '{dzi_file}'.")

def add_to_hex_bins(hex_bins, hex_id, feature_id, classification, color):
    if hex_id not in hex_bins:
        hex_bins[hex_id] = {
            "feature_ids": [],
            "annotation_count": 0,
            "classifications": {},
        }
    hex_bins[hex_id]["feature_ids"].append(feature_id)
    hex_bins[hex_id]["annotation_count"] += 1
    if classification not in hex_bins[hex_id]["classifications"]:
        hex_bins[hex_id]["classifications"][classification] = {"count": 0, "color": color}
    hex_bins[hex_id]["classifications"][classification]["count"] += 1

def normalize_to_lat_lon(x, y, image_width, image_height):
    normalized_x = x / image_width
    normalized_y = y / image_height
    latitude = normalized_y * 180 - 90
    longitude = normalized_x * 360 - 180
    return latitude, longitude

def lat_lon_to_image_coordinates(lat, lon, image_width, image_height):
    x = ((lon + 180) / 360) * image_width
    y = ((lat + 90) / 180) * image_height
    return x, y

if __name__ == "__main__":
    resolutions = [2]
    filename = "Cell Contours.geojson"  # Replace with the specific filename
    dzi_file = "TCGA-V5-A7RE-11A-01-TS1.57401526-EF9E-49AC-8FF6-B4F9652311CE.svs"  # Replace with the specific DZI file

    try:
        compute_hexagons_for_specific_file_and_dzi(resolutions, filename, dzi_file)
    except Exception as e:
        print(f"Error: {e}")
