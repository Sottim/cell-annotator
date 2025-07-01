# Cell Annotator

## Project Overview

Cell Annotator is a web-based tool for visualizing, annotating, and analyzing whole slide images (WSIs) and image patches in pathology. It supports multi-model cell annotation overlays for histopathology research.

---

## Tech Stack

- **Frontend:** React, OpenSeadragon, PixiJS, Axios
- **Backend:** Python (Flask), OpenSlide, DeepZoom, MongoDB (with GridFS), PyMongo
- **Database:** MongoDB (annotations and metadata)
- **Image Storage:** Local filesystem for images, DZI files, and tiles
- **Annotation Storage:** MongoDB GridFS

---

## Input & Output Formats

### Input
- **Whole Slide Images (WSIs):** `.svs`, `.tiff`, `.png` (patches)
- **Annotations:** `.geojson` (per image and model, e.g., `image1_cellvit.geojson`)

### Output
- **Interactive WSI/patch viewer with zoom and pan**
- **Overlayed cell annotations (per model)**

---

## Setup Instructions

### 1. Clone the Repository
```bash
git clone <repo-url>
cd cell-annotator
```

### 2. Backend Setup
- **Python 3.8+** and **pip** required
- **MongoDB** (local or remote instance)
- **Install dependencies:**
```bash
pip install -r requirements.txt
```
- **Install OpenSlide:**
  - Ubuntu: `sudo apt-get install openslide-tools python3-openslide`
  - Mac: `brew install openslide`
  - Windows: [Download binaries from OpenSlide website](https://openslide.org/download/)
- **Set up environment variables:**
  - Create a `.env` file with your MongoDB URI:
    ```
    MONGO_URI=mongodb://localhost:27017
    ```

### 3. Frontend Setup
- **Node.js (v16+) and npm required**
- Navigate to the frontend directory:
```bash
cd frontend
npm install
```

---

## How to Run the Application

### 1. Start the Backend
From the project root:
```bash
python app.py
```

### 2. Start the Frontend
From the `frontend` directory:
```bash
npm start
```

- The app will open in your browser at `http://localhost:3000`.

Alternatively, you can start `both the frontend and backend together` by running the below executable script in the project directory.
```bash
./start-app.sh
```

---

## Usage Guide

### Uploading Images
- Use the "Upload" section to upload WSIs (`.svs`, `.tiff`) or patches (`.png`).
- The backend will generate DeepZoom (DZI) tiles for efficient viewing.

### Uploading Annotations
- Use the annotation upload section to upload `.geojson` files.
- Select the image and model (e.g., cellvit, cellvitplus, hovernet) before uploading.
- Annotation files must be named as `<image_filename_without_extension>_<model_name>.geojson` (e.g., `gall-bladder-patch_cellvit.geojson`).
- The app supports multiple models per image; select the model to view its annotations.

---

## Dependencies

- Python: Flask, OpenSlide, PyMongo, python-dotenv
- Node.js: React, OpenSeadragon, PixiJS, Axios
- MongoDB (local or remote)

---

## Application Snapshots

You can find the snapshots of the application in the [`/imgs`](./imgs) directory.


## Notes
- Make sure MongoDB is running before starting the backend.
- For large WSIs, ensure you have enough disk space for DZI tiles.
- Annotation files must follow the naming conventions for correct association.
- For custom model support, add the model name to the backend `/available_models` endpoint.

---

## Future Plans
- **Clinical Information:**
  - Display clinical info (e.g., patient metadata, diagnosis) for each image.
  - Support for uploading and associating clinical info files (e.g., `image1_clinical.json`).
- **Cell Type Distribution/Count Graphs:**
  - Display cell type distribution or count graphs for each image and model.
  - Support for uploading and visualizing cell count data (e.g., `image1_cellvit_counts.json` or `.png`).

---

## Contact

For questions or contributions, please contact the **Augmented Health Systems** team, or personally reach out via GitHub:
- [Sottim](https://github.com/Sottim)
- [zahaanshapoorjee](https://github.com/zahaanshapoorjee)


Alternatively, feel free to [open an issue](../../issues) in this repository.

#####
