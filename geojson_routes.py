from flask import Blueprint, request, jsonify
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from dotenv import load_dotenv
import os
import json

# Load environment variables from .env file
load_dotenv()

# Get the MongoDB URI from the .env file
mongo_uri = os.getenv("MONGO_URI")

# Create a new MongoDB client and connect to the server
client = MongoClient(mongo_uri, server_api=ServerApi('1'))

# Test the connection by pinging the server
try:
    client.admin.command('ping')
    print("Pinged your deployment. You successfully connected to MongoDB!")
except Exception as e:
    print(f"Failed to connect to MongoDB: {e}")

# Access the MongoDB database and collection
db = client.annotationsDB  # Database name
geojson_collection = db.geojson_annotations  # Collection name for storing GeoJSON

# Create a Blueprint for the geojson-related routes
geojson_blueprint = Blueprint('geojson', __name__)

# Route to upload GeoJSON
@geojson_blueprint.route('/upload_geojson', methods=['POST'])
def upload_geojson():
    file = request.files.get('file')
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    try:
        geojson_data = json.load(file)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid GeoJSON format"}), 400

    # Check if GeoJSON file with the same name exists
    filename = file.filename
    if geojson_collection.find_one({"filename": filename}):
        return jsonify({"message": "GeoJSON file already exists"}), 400

    # Insert into MongoDB
    geojson_collection.insert_one({
        "filename": filename,
        "geojson": geojson_data
    })

    return jsonify({"message": "GeoJSON file uploaded successfully"}), 200

# Route to retrieve all GeoJSON annotations
@geojson_blueprint.route('/get_geojson_annotations', methods=['GET'])
def get_geojson_annotations():
    annotations = geojson_collection.find()
    result = [{"filename": doc["filename"], "geojson": doc["geojson"]} for doc in annotations]
    return jsonify(result), 200

@geojson_blueprint.route('/get_normalized_annotations', methods=['POST'])
def get_normalized_annotations():
    data = request.json
    bounds = data.get('bounds')
    filename = data.get('filename')

    if not bounds or not filename:
        return jsonify({"error": "Bounds and filename are required"}), 400

    filename = filename[:-4] if filename.endswith('.dzi') else filename

    x_min = round(bounds.get('xMin', 6), 6)
    x_max = round(bounds.get('xMax', 6), 6)
    y_min = round(bounds.get('yMin', 6), 6)
    y_max = round(bounds.get('yMax', 6), 6)

    try:
        query = {"dzi_file": filename}
        matching_documents = list(geojson_collection.find(query))

        grouped_annotations = {}
        for doc in matching_documents:
            geojson_data = doc.get('geojson', [])
            filtered_features = []

            for feature in geojson_data:
                geometry = feature.get('geometry', {})
                coordinates = geometry.get('coordinates', [])

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

            # Group annotations by filename
            grouped_annotations[doc["filename"]] = filtered_features

        return jsonify(grouped_annotations), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@geojson_blueprint.route('/link_annotation_to_dzi', methods=['POST'])
def link_annotation_to_dzi():
    print(request.files)
    print(request.form)

    file = request.files['file']
    filename = file.filename
    dzi_file = request.form.get('dziFile')  # Get the associated DZI file

    if not dzi_file:
        return jsonify({"error": "DZI file is required"}), 400

    file_path = os.path.join('annotations', filename)

    os.makedirs('annotations', exist_ok=True)
    file.save(file_path)

    # Insert into MongoDB, linking the annotation to the DZI file
    geojson_collection.insert_one({
        "filename": filename,
        "dzi_file": dzi_file,  # Save the DZI file linked to this annotation
        "annotation_file": file_path,
        "geojson": json.load(open(file_path))
    })

    return jsonify({"message": "Annotation file uploaded and linked to DZI successfully", "filename": filename})
