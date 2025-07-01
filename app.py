# If the file already exist, dont upload. Also if the DZI slices have been made, then don't make them again
# Save and load annotations from the backend

from flask import Flask, request, jsonify, send_from_directory, render_template_string
from flask_cors import CORS
import os
import platform
if platform.system() == "Windows":
    os.add_dll_directory(r"C:\Program Files (x86)\OpenSlide\bin")

import openslide
from openslide.deepzoom import DeepZoomGenerator
import json
from geojson_routes import geojson_blueprint  # Import the GeoJSON routes
from dotenv import load_dotenv
from PIL import Image

load_dotenv()


app = Flask(__name__)
CORS(app)

app.register_blueprint(geojson_blueprint)

@app.route('/')
def index():
    return render_template_string('<h1>Welcome to the Pathology Annotator</h1>')

@app.route('/upload', methods=['POST'])
def upload_image():
    file = request.files['file']
    filename = file.filename
    file_path = os.path.join('uploads', filename)
    
    # Paths for the DeepZoom files
    dzi_path = os.path.join('output', filename + '.dzi')
    tiles_path = os.path.join('output', filename + '_files')
    
    # Check if the file already exists
    if os.path.exists(file_path):
        print("File already exists")
        # Check if the DeepZoom files also exist
        if os.path.exists(dzi_path) and os.path.exists(tiles_path):
            print("DeepZoom tiles already exist")
            return jsonify({"message": "Image already exists and is converted", "dzi_path": filename + '.dzi'})
        else:
            print("DeepZoom tiles do not exist, generating tiles")
            try:
                slide = openslide.OpenSlide(file_path)
                generate_deepzoom(slide, dzi_path, tiles_path)
                return jsonify({"message": "DeepZoom tiles created", "dzi_path": filename + '.dzi'})
            except openslide.OpenSlideUnsupportedFormatError:
                return jsonify({"error": "Unsupported or missing image file"}), 400
    else:
        print(f"Saving file at: {file_path}")
        os.makedirs('uploads', exist_ok=True)
        file.save(file_path)
        
        # Check if file was saved correctly
        if not os.path.exists(file_path):
            print("File was not saved correctly")
            return jsonify({"error": "File was not saved correctly"}), 500
        
        try:
            slide = openslide.OpenSlide(file_path)
            print("Opened slide successfully")
            generate_deepzoom(slide, dzi_path, tiles_path)
            return jsonify({"message": "Image uploaded and converted successfully", "dzi_path": filename + '.dzi'})
        except openslide.OpenSlideUnsupportedFormatError:
            print("Unsupported or missing image file")
            return jsonify({"error": "Unsupported or missing image file"}), 400

def generate_deepzoom(slide, dzi_path, tiles_path):
    tile_size = 128
    overlap = 2
    limit_bounds = True
    generator = DeepZoomGenerator(slide, tile_size=tile_size, overlap=overlap, limit_bounds=limit_bounds)
    
    os.makedirs(tiles_path, exist_ok=True)
    
    with open(dzi_path, 'w') as f:
        f.write(generator.get_dzi('jpeg'))
    
    for level in range(generator.level_count):
        level_dir = os.path.join(tiles_path, str(level))
        os.makedirs(level_dir, exist_ok=True)
        cols, rows = generator.level_tiles[level]
        for col in range(cols):
            for row in range(rows):
                tile = generator.get_tile(level, (col, row))
                tile_path = os.path.join(level_dir, f'{col}_{row}.jpeg')
                tile.save(tile_path)
                print(f"Saved tile at: {tile_path}")

    print(f"DZI and tiles created successfully: {dzi_path}")

@app.route('/available_images', methods=['GET'])
def get_available_images():
    output_folder = 'output'
    available_files = [
        f for f in os.listdir(output_folder) if f.endswith('.dzi')
    ]
    return jsonify({"images": available_files})


@app.route('/output/<path:filename>')
def output_files(filename):
    return send_from_directory('output', filename)

@app.route('/upload_patch', methods=['POST'])
def upload_patch():
    file = request.files['file']
    filename = file.filename
    if not filename.lower().endswith('.png'):
        return jsonify({'error': 'Only .png files are supported for patch upload.'}), 400
    file_path = os.path.join('uploads', filename)
    dzi_path = os.path.join('output', filename + '.dzi')
    tiles_path = os.path.join('output', filename + '_files')

    # Check if the file already exists
    if os.path.exists(file_path):
        if os.path.exists(dzi_path) and os.path.exists(tiles_path):
            return jsonify({'message': 'Patch already exists and is converted', 'dzi_path': filename + '.dzi'})
    else:
        os.makedirs('uploads', exist_ok=True)
        file.save(file_path)

    try:
        img = Image.open(file_path)
        generate_deepzoom_patch(img, dzi_path, tiles_path)
        return jsonify({'message': 'Patch uploaded and converted successfully', 'dzi_path': filename + '.dzi'})
    except Exception as e:
        return jsonify({'error': f'Failed to process patch: {str(e)}'}), 500


def generate_deepzoom_patch(img, dzi_path, tiles_path):
    tile_size = 128
    overlap = 2
    format = 'jpeg'
    import math
    width, height = img.size
    max_dim = max(width, height)
    level_count = int(math.ceil(math.log(max_dim, 2))) + 1

    os.makedirs(tiles_path, exist_ok=True)
    # Write DZI file
    dzi_template = f'''<?xml version="1.0" encoding="UTF-8"?>\n<Image TileSize="{tile_size}" Overlap="{overlap}" Format="{format}" xmlns="http://schemas.microsoft.com/deepzoom/2008">\n    <Size Width="{width}" Height="{height}"/>\n</Image>'''
    with open(dzi_path, 'w') as f:
        f.write(dzi_template)

    for level in range(level_count):
        scale = 2 ** (level_count - level - 1)
        level_width = int(math.ceil(width / scale))
        level_height = int(math.ceil(height / scale))
        level_img = img.resize((level_width, level_height), Image.LANCZOS)
        level_dir = os.path.join(tiles_path, str(level))
        os.makedirs(level_dir, exist_ok=True)
        cols = int(math.ceil(level_width / tile_size))
        rows = int(math.ceil(level_height / tile_size))
        for col in range(cols):
            for row in range(rows):
                # Calculate overlap-aware crop boundaries
                left = col * tile_size
                upper = row * tile_size
                right = left + tile_size
                lower = upper + tile_size
                # Add overlap except at the edges
                if col > 0:
                    left -= overlap
                if row > 0:
                    upper -= overlap
                if col < cols - 1:
                    right += overlap
                if row < rows - 1:
                    lower += overlap
                # Clamp to image boundaries
                left = max(left, 0)
                upper = max(upper, 0)
                right = min(right, level_width)
                lower = min(lower, level_height)
                tile = level_img.crop((left, upper, right, lower))
                tile_path = os.path.join(level_dir, f'{col}_{row}.{format}')
                tile.save(tile_path, format=format.upper())

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
            # ... rest of your code ...

if __name__ == '__main__':
    app.run(debug=True)