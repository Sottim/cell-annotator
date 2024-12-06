from flask import Blueprint, request, jsonify
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from pymongo.errors import PyMongoError
from gridfs import GridFS
from bson.objectid import ObjectId
import os
import json
import pymongo


# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# MongoDB setup
mongo_uri = os.getenv("MONGO_URI")
client = MongoClient(mongo_uri, server_api=ServerApi('1'))
db = client.annotationsDB
geojson_fs = GridFS(db)
geojson_collection = db.geojson_annotations
hexbin_collection = db.geojson_hex_bins


# Blueprint for GeoJSON routes
geojson_blueprint = Blueprint('geojson', __name__)

@geojson_blueprint.route('/link_annotation_to_dzi', methods=['POST'])
def link_annotation_to_dzi():
    file = request.files['file']
    filename = file.filename
    dzi_file = request.form.get('dziFile')  # Get the associated DZI file
    image_width = request.form.get('imageWidth')  # Get the image width
    image_height = request.form.get('imageHeight')  # Get the image height

    if not dzi_file:
        return jsonify({"error": "DZI file is required"}), 400

    if not image_width or not image_height:
        return jsonify({"error": "Image dimensions (width and height) are required"}), 400

    # Convert dimensions to integers
    try:
        image_width = int(image_width)
        image_height = int(image_height)
    except ValueError:
        return jsonify({"error": "Invalid image dimensions"}), 400

    # Save the file locally
    file_path = os.path.join('annotations', filename)
    os.makedirs('annotations', exist_ok=True)
    file.save(file_path)

    try:
        # Read the GeoJSON data from the file
        with open(file_path, 'r') as f:
            geojson_data = json.load(f)

        # Insert the full GeoJSON data into MongoDB as a normal document
        geojson_collection.insert_one({
            "filename": filename,
            "dzi_file": dzi_file,  # Save the DZI file linked to this annotation
            "geojson": geojson_data,  # Store the full GeoJSON content
            "image_width": image_width,  # Store image width
            "image_height": image_height  # Store image height
        })

        # Save the file to GridFS
        with open(file_path, 'rb') as f:
            file_id = geojson_fs.put(f, filename=filename, dzi_file=dzi_file)

        return jsonify({
            "message": "Annotation file uploaded and linked to DZI successfully",
            "filename": filename,
            "file_id": str(file_id),
            "image_width": image_width,
            "image_height": image_height
        })

    except PyMongoError as e:
        return jsonify({"error": str(e)}), 500

    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

@geojson_blueprint.route('/get_normalized_annotations', methods=['POST'])
def get_normalized_annotations():
    data = request.json
    bounds = data.get('bounds')
    filename = data.get('filename')

    if not bounds or not filename:
        return jsonify({"error": "Bounds and filename are required"}), 400

    filename = filename[:-4] if filename.endswith('.dzi') else filename
    x_min, x_max = round(bounds.get('xMin', 6), 6), round(bounds.get('xMax', 6), 6)
    y_min, y_max = round(bounds.get('yMin', 6), 6), round(bounds.get('yMax', 6), 6)

    try:
        # Retrieve all files with the matching dzi_file
        file_cursor = geojson_fs.find({"dzi_file": filename})
        file_list = list(file_cursor)

        if not file_list:
            print("No files found for the given filename.")
            return jsonify({"error": "No annotations found for the given filename"}), 404

        print(f"Number of files found: {len(file_list)}")
        grouped_annotations = {}

        for file_obj in file_list:
            file_name = file_obj.filename  # e.g., "Cell Centroids.geojson"
            geojson_data = json.loads(file_obj.read())

            # Check if geojson_data is a list or dictionary
            if isinstance(geojson_data, list):
                features = geojson_data  # Assume each item is a feature
            elif isinstance(geojson_data, dict):
                features = geojson_data.get('features', [])
            else:
                print("Unsupported GeoJSON structure.")
                continue

            filtered_features = []

            for feature in features:
                geometry = feature.get('geometry', {})
                coordinates = geometry.get('coordinates', [])
                # Filter based on bounds
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

            # Use the document's filename as a key to group annotations
            grouped_annotations[file_name] = filtered_features

        return jsonify(grouped_annotations), 200

    except PyMongoError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

@geojson_blueprint.route('/get_hex_bins', methods=['POST'])
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
            {
                "_id": 0, 
                "hex_id": 1, 
                "annotation_count": 1, 
                "feature_ids": 1, 
                "image_coordinates": 1, 
                "classifications": 1  # Include classifications (name and color)
            }
        ))

        return jsonify({"hex_bins": hex_bins})

    except PyMongoError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500
