# If the file already exist, dont upload. Also if the DZI slices have been made, then don't make them again
# Save and load annotations from the backend

from flask import Flask, request, jsonify, send_from_directory, render_template_string
from flask_cors import CORS
import os
os.add_dll_directory(r"C:\Program Files (x86)\OpenSlide\bin")  # Replace with the directory containing libopenslide-1.dll
import openslide
from openslide.deepzoom import DeepZoomGenerator
import json

app = Flask(__name__)
CORS(app)

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

@app.route('/annotations/<filename>', methods=['GET'])
def get_annotations(filename):
    annotations_path = os.path.join('annotations', filename)
    if os.path.exists(annotations_path):
        with open(annotations_path, 'r') as f:
            annotations = json.load(f)
        return jsonify(annotations)
    else:
        return jsonify({"error": "Annotation file not found"}), 404

@app.route('/upload_annotations', methods=['POST'])
def upload_annotations():
    file = request.files['file']
    filename = file.filename
    file_path = os.path.join('annotations', filename)
    
    os.makedirs('annotations', exist_ok=True)
    file.save(file_path)
    
    return jsonify({"message": "Annotation file uploaded successfully", "filename": filename})

@app.route('/output/<path:filename>')
def output_files(filename):
    return send_from_directory('output', filename)


if __name__ == '__main__':
    app.run(debug=True)