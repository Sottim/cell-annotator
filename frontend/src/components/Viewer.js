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
  const [visibleAnnotations, setVisibleAnnotations] = useState({});
  const [annotationTypes, setAnnotationTypes] = useState([]);
  const [zoomValue, setZoomValue] = useState(0); // State to control zoom slider

  // Drawing annotations
  const drawAnnotationsOnCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
  
    // Clear the canvas before drawing
    context.clearRect(0, 0, canvas.width, canvas.height);
  
    if (!viewer || !viewer.world) return;
  
    annotations.forEach((feature) => {
      const { classification } = feature.properties;
      const { geometry } = feature;
  
      if (!geometry || !geometry.coordinates) return;
      if (!visibleAnnotations[classification.name]) return; // Only draw visible annotations
  
      context.fillStyle = `rgb(${classification.color[0]}, ${classification.color[1]}, ${classification.color[2]})`;
  
      geometry.coordinates.forEach((point) => {
        const [x, y] = point;
  
        // Convert image coordinates to viewport coordinates
        const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
        const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  
        // Draw annotation on the canvas at the correct position
        context.beginPath();
        context.arc(screenPoint.x, screenPoint.y, 2, 0, 2 * Math.PI, false);
        context.fill();
      });
    });
  };
  
  
  
  

  // Update the canvas size to match the viewer container
  const updateCanvasSize = () => {
    const canvas = canvasRef.current;
    if (viewerRef.current && canvas) {
      // Set the canvas to match the viewer's size
      canvas.width = viewerRef.current.clientWidth;
      canvas.height = viewerRef.current.clientHeight;
      drawAnnotationsOnCanvas(); // Redraw the annotations after resizing
    }
  };
  
  

  // Load and display annotations
  const loadAndDisplayAnnotations = async (annotationFilename) => {
    try {
      const response = await axios.get(`http://localhost:5000/annotations/${annotationFilename}`);
      const features = response.data;

      setAnnotations(features);
      const uniqueTypes = [...new Set(features.map((feature) => feature.properties.classification.name))];

      setAnnotationTypes(uniqueTypes);
      setVisibleAnnotations(uniqueTypes.reduce((acc, type) => ({ ...acc, [type]: true }), {}));

      if (viewer) {
        updateCanvasSize(); // Ensure that annotations are drawn when loaded
      }
    } catch (error) {
      console.error('Error loading annotations:', error);
    }
  };

  // Toggle annotation visibility
  const handleToggleAnnotation = (type) => {
    setVisibleAnnotations((prevState) => ({
      ...prevState,
      [type]: !prevState[type],
    }));
  };

  // Initialize OpenSeadragon viewer
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
        setZoomValue(newViewer.viewport.getZoom());
      });

      newViewer.addHandler('pan', updateCanvasSize);
      newViewer.addHandler('zoom', updateCanvasSize);
      newViewer.addHandler('animation', updateCanvasSize);

      return () => {
        newViewer.removeHandler('pan', updateCanvasSize);
        newViewer.removeHandler('zoom', updateCanvasSize);
        newViewer.removeHandler('animation', updateCanvasSize);
      };
    }
  }, [dziUrl, viewer]);


  useEffect(() => {
    if (viewer) {
      // Redraw annotations whenever zoom or pan occurs
      const handlePanZoom = () => {
        drawAnnotationsOnCanvas(); // Redraw annotations after pan/zoom
      };
  
      // Attach event handlers
      viewer.addHandler('zoom', handlePanZoom);
      viewer.addHandler('pan', handlePanZoom);
      viewer.addHandler('animation', handlePanZoom);
  
      // Cleanup event handlers on component unmount
      return () => {
        viewer.removeHandler('zoom', handlePanZoom);
        viewer.removeHandler('pan', handlePanZoom);
        viewer.removeHandler('animation', handlePanZoom);
      };
    }
  }, [viewer, annotations, visibleAnnotations]);
  
  
  
  // Redraw annotations when visibility changes
  useEffect(() => {
    if (annotations.length > 0) {
      drawAnnotationsOnCanvas();
    }
  }, [visibleAnnotations, annotations, zoomValue]);

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
  
      await loadAndDisplayAnnotations(annotationFile.name);
      updateCanvasSize(); // Ensure canvas and annotations are redrawn after upload
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
    
    {/* Legend Box */}
    <div className="annotation-legend">
      <ul>
        {annotationTypes.map((type) => {
          const color = annotations.find((feature) => feature.properties.classification.name === type)?.properties.classification.color;
          if (!color) return null;

          return (
            <li key={type} style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '15px',
                  height: '15px',
                  backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
                  marginRight: '10px',
                }}
              ></span>
              {type}
            </li>
          );
        })}
      </ul>
    </div>
  </div>
</div>


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
      <div className="annotation-toggles">
        <h3>Toggle Annotations</h3>
        {annotationTypes.map((type) => (
          <div key={type}>
            <label>
              <input
                type="checkbox"
                checked={visibleAnnotations[type]}
                onChange={() => handleToggleAnnotation(type)}
              />
              {type}
            </label>
          </div>
        ))}
        {!annotationTypes.length>0 && <>Please Upload Annotations!</>}
        
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
