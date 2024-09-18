import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import axios from 'axios';
import './Viewer.css'; // Import the stylesheet

const Viewer = ({ dziUrl, filename }) => {
  const viewerRef = useRef(null);
  const canvasRef = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [annotationFile, setAnnotationFile] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [zoomValue, setZoomValue] = useState(0); // State to control zoom slider

  const drawAnnotationsOnCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!viewer || !viewer.world) {
      console.error('Viewer or world object is not ready.');
      return;
    }

    annotations.forEach((feature) => {
      feature.geometry.coordinates.forEach((point) => {
        const [x, y] = point;
        const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
        const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);

        context.beginPath();
        context.arc(screenPoint.x, screenPoint.y, 2, 0, 2 * Math.PI, false);
        context.fillStyle = 'red';
        context.fill();
      });
    });
  };

  const updateCanvasSize = () => {
    const canvas = canvasRef.current;
    canvas.width = viewerRef.current.clientWidth;
    canvas.height = viewerRef.current.clientHeight;
    drawAnnotationsOnCanvas();
  };

  const loadAndDisplayAnnotations = async (annotationFilename) => {
    try {
      const response = await axios.get(`http://localhost:5000/annotations/${annotationFilename}`);
      const features = response.data;
      setAnnotations(features);
      drawAnnotationsOnCanvas();

      if (viewer) {
        viewer.removeHandler('animation', updateCanvasSize);
        viewer.removeHandler('pan', updateCanvasSize);
        viewer.removeHandler('zoom', updateCanvasSize);

        viewer.addHandler('animation', updateCanvasSize);
        viewer.addHandler('pan', updateCanvasSize);
        viewer.addHandler('zoom', updateCanvasSize);
      }
    } catch (error) {
      console.error('Error loading annotations:', error);
    }
  };

  useEffect(() => {
    if (viewerRef.current && !viewer) {
      const newViewer = OpenSeadragon({
        element: viewerRef.current,
        tileSources: dziUrl,
        showNavigationControl: false,
      });

      newViewer.addHandler('open', () => {
        setViewer(newViewer);
        updateCanvasSize();
        setZoomValue(newViewer.viewport.getZoom()); // Initialize slider with current zoom
      });

      newViewer.addHandler('zoom', () => {
        setZoomValue(newViewer.viewport.getZoom()); // Update slider when zoom changes
      });
    }
  }, [dziUrl, viewer]);

  const handleZoomChange = (event) => {
    const zoomLevel = parseFloat(event.target.value);
    if (viewer) {
      viewer.viewport.zoomTo(zoomLevel);
    }
  };

  const handleAnnotationFileChange = (event) => {
    setAnnotationFile(event.target.files[0]);
  };

  const handleAnnotationUpload = async () => {
    if (!annotationFile) {
      alert('Please select an annotation file first!');
      return;
    }

    const formData = new FormData();
    formData.append('file', annotationFile);

    try {
      await axios.post('http://localhost:5000/upload_annotations', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      loadAndDisplayAnnotations(annotationFile.name);
    } catch (error) {
      console.error('Error uploading annotation file:', error);
    }
  };

  return (
    <div className="viewer-container">
      <div className="viewer-header">
        <h1>Whole Slide Image Viewer</h1>
      </div>
      <div className="viewer-wrapper">
        <div className="viewer-box">
          <div id="openseadragon-viewer" ref={viewerRef} className="wsi-viewer"></div>
          <canvas ref={canvasRef} className="annotation-canvas" />
        </div>
        {/* Zoom Slider */}
        <div className="zoom-slider-container">
          <input
            id="zoomSlider"
            className="zoom-slider"
            type="range"
            min={viewer ? viewer.viewport.getMinZoom() : 0.1}
            max={viewer ? viewer.viewport.getMaxZoom() : 2}
            step={0.01}
            value={zoomValue}
            onChange={handleZoomChange}
          />
        </div>
      </div>

      <div className="upload-section">
        <input type="file" onChange={handleAnnotationFileChange} accept=".json,.geojson" />
        <button onClick={handleAnnotationUpload} className="upload-btn">
          Upload Annotations
        </button>
      </div>
    </div>
  );
};

export default Viewer;
