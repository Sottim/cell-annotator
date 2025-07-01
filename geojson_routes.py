from flask import Blueprint, request, jsonify
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from pymongo.errors import PyMongoError
from gridfs import GridFS
from bson.objectid import ObjectId
import os
import json
import pymongo
import h3
# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# MongoDB setup
mongo_uri = os.getenv("MONGO_URI")
client = MongoClient(mongo_uri, server_api=ServerApi('1'))
db = client.annotationsDB
geojson_fs = GridFS(db)
hexbin_collection = db.geojson_hex_bins
grid_fs = GridFS(db)





# Blueprint for GeoJSON routes
geojson_blueprint = Blueprint('geojson', __name__)



@geojson_blueprint.route('/link_annotation_to_dzi', methods=['POST'])
def link_annotation_to_dzi():
    """
    Uploads annotation file to GridFS, links it to the specified DZI file, and stores metadata.
    Calls compute_hexagons_for_specific_file_and_dzi to process the uploaded data.
    """
    file = request.files['file']
    image_filename = request.form.get('dziFile')  # This is the image filename (e.g., gall-bladder-patch.png)
    model_name = request.form.get('modelName')     # New: model name from dropdown
    image_width = request.form.get('imageWidth')
    image_height = request.form.get('imageHeight')

    if not image_filename or not image_width or not image_height or not model_name:
        return jsonify({"error": "Image filename, model name, width, and height are required"}), 400

    # Remove extension from image filename
    base_image_name = os.path.splitext(image_filename)[0]
    annotation_filename = f"{base_image_name}_{model_name}.geojson"

    # Check for duplicate in GridFS
    existing = geojson_fs.find_one({"filename": annotation_filename})
    if existing:
        return jsonify({"error": "Annotation for this image and model already exists."}), 409

    # Check for duplicate in GridFS and delete if exists
    # existing = geojson_fs.find_one({"filename": annotation_filename})
    # if existing:
    #     geojson_fs.delete(existing._id)

    try:
        image_width = int(image_width)
        image_height = int(image_height)

        file_id = geojson_fs.put(file, filename=annotation_filename, metadata={
            "filename": annotation_filename,
            "dzi_file": image_filename,
            "model_name": model_name,
            "image_width": image_width,
            "image_height": image_height,
            "file_size": file.content_length,
        })

        # Call compute_hexagons_for_specific_file_and_dzi with the uploaded file details
        resolutions = [2]  # Example resolution; adjust as needed
        compute_hexagons_for_specific_file_and_dzi(resolutions, annotation_filename, image_filename)

        return jsonify({
            "message": "Annotation file uploaded and linked to DZI successfully using GridFS.",
            "filename": annotation_filename,
            "dzi_file": image_filename,
            "file_id": str(file_id),
            "image_width": image_width,
            "image_height": image_height,
        }), 200

    except PyMongoError as e:
        print("PyMongoError:", e)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        import traceback
        print("Unexpected error in /link_annotation_to_dzi:")
        traceback.print_exc()
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500
def process_geojson(dzi_file, geojson_data, image_width, image_height, resolutions):
    """
    Process GeoJSON data to compute hexagons and store them in the hexbin collection.
    """
    # Handle both dict (FeatureCollection) and list (features) input
    if isinstance(geojson_data, dict) and "features" in geojson_data:
        features = geojson_data["features"]
    elif isinstance(geojson_data, list):
        features = geojson_data
    else:
        print("Invalid GeoJSON format: expected dict with 'features' or a list.")
        return

    for resolution in resolutions:
        hex_bins = {}

        for feature in features:
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



@geojson_blueprint.route('/get_normalized_annotations', methods=['POST'])
def get_normalized_annotations():
    """
    Fetches and filters annotations within viewport bounds for a specified DZI file from GridFS.
    """
    data = request.json
    bounds = data.get('bounds')
    dzi_file = data.get('filename')  # filename is the dzi_file
    zoom = data.get('zoom', 8)  # Default to 8 if not provided
    model_name = data.get('modelName')

    if not bounds or not dzi_file:
        return jsonify({"error": "Bounds and DZI file are required"}), 400

    # Detect if this is a patch
    is_patch = dzi_file.endswith('.png') or dzi_file.endswith('.png.dzi')

    dzi_file = dzi_file[:-4] if dzi_file.endswith('.dzi') else dzi_file
    x_min, x_max = round(bounds.get('xMin', 6), 6), round(bounds.get('xMax', 6), 6)
    y_min, y_max = round(bounds.get('yMin', 6), 6), round(bounds.get('yMax', 6), 6)

    try:
        # Retrieve files associated with the specified DZI file from GridFS
        file_cursor = geojson_fs.find({"metadata.dzi_file": dzi_file})
        file_list = list(file_cursor)

        if not file_list:
            return jsonify({"error": "No annotations found for the specified DZI file"}), 404

        grouped_annotations = {}

        for file_obj in file_list:
            # Only process files for the selected model
            if model_name and file_obj.metadata.get("model_name") != model_name:
                continue
            file_name = file_obj.metadata.get("filename", "Unknown File")
            geojson_data = json.loads(file_obj.read().decode('utf-8'))

            # Ensure geojson_data is a list or a dictionary containing 'features'
            if isinstance(geojson_data, dict):
                features = geojson_data.get('features', [])
            elif isinstance(geojson_data, list):
                features = geojson_data  # Assume each item is a feature
            else:
                return jsonify({"error": "Invalid GeoJSON format"}), 400

            filtered_features = []

            # If patch, skip bounds filtering and return all features
            if is_patch:
                filtered_features = features
            else:
                for feature in features:
                    geometry = feature.get('geometry', {})
                    coordinates = geometry.get('coordinates', [])

                    # Filter features based on bounds
                    if geometry.get('type') in ['Point', 'MultiPoint']:
                        filtered_points = [
                            point for point in coordinates
                            if x_min <= point[0] <= x_max and y_min <= point[1] <= y_max
                        ]
                        if filtered_points:
                            feature['geometry']['coordinates'] = filtered_points
                            filtered_features.append(feature)

                    elif geometry.get('type') in ['Polygon', 'MultiPolygon']:
                        filtered_polygons = []
                        for polygon in coordinates:
                            filtered_rings = [
                                [point for point in ring if x_min <= point[0] <= x_max and y_min <= point[1] <= y_max]
                                for ring in polygon
                            ]
                            filtered_rings = [ring for ring in filtered_rings if ring]
                            if filtered_rings:
                                filtered_polygons.append(filtered_rings)
                        if filtered_polygons:
                            feature['geometry']['coordinates'] = filtered_polygons
                            filtered_features.append(feature)

            grouped_annotations[file_name] = filtered_features

        return jsonify(grouped_annotations), 200

    except PyMongoError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


@geojson_blueprint.route('/get_hex_bins', methods=['POST'])
def get_hex_bins():
    """
    Retrieves hex bins for a specified DZI file and resolution. Provides metadata for files if no hex bins are found.
    """
    try:
        data = request.json
        dzi_file = data.get("dzi_file")
        resolution = data.get("resolution")

        if not dzi_file or not resolution:
            return jsonify({"error": "DZI file and resolution are required"}), 400

        # Query MongoDB for hex bins
        hex_bins = list(hexbin_collection.find(
            {"dzi_file": dzi_file, "resolution": int(resolution)},
            {"_id": 0, "hex_id": 1, "annotation_count": 1, "feature_ids": 1, "image_coordinates": 1, "classifications": 1}
        ))

        if not hex_bins:
            # If no hex bins, retrieve metadata from GridFS
            gridfs_files = list(db.fs.files.find({"metadata.dzi_file": dzi_file}))

            if not gridfs_files:
                return jsonify({"error": "No hex bins or matching file in GridFS found for the given DZI file"}), 404

            metadata = [
                {
                    "dzi_file": file_doc["metadata"].get("dzi_file"),
                    "image_width": file_doc["metadata"].get("image_width"),
                    "image_height": file_doc["metadata"].get("image_height"),
                    "file_name": file_doc.get("filename"),
                    "file_size": file_doc["metadata"].get("file_size"),
                }
                for file_doc in gridfs_files
            ]

            return jsonify({
                "message": "No hex bins found, but metadata for matching files in GridFS retrieved",
                "file_metadata": metadata
            }), 200

        return jsonify({"hex_bins": hex_bins}), 200

    except PyMongoError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

@geojson_blueprint.route('/annotation_model_mapping', methods=['GET'])
def annotation_model_mapping():
    # Build mapping: {image_filename: [model1, model2, ...]}
    mapping = {}
    for file_doc in db.fs.files.find({"filename": {"$regex": r".+_.+\\.geojson$"}}):
        filename = file_doc["filename"]
        # Extract image and model
        if "_" in filename:
            base, model_ext = filename.rsplit("_", 1)
            model = model_ext.replace(".geojson", "")
            image = base
            mapping.setdefault(image, []).append(model)
    return jsonify(mapping)

@geojson_blueprint.route('/available_models', methods=['GET'])
def available_models():
    return jsonify({"models": ["cellvit", "cellvitplus", "hovernet"]})