import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import axios from 'axios';
import * as PIXI from 'pixi.js';
import { Application } from 'pixi.js';
import './Viewer.css'; // Import the stylesheet
import DBSCAN from 'density-clustering';
import ClipLoader from 'react-spinners/ClipLoader'; // Import React Spinners

const Viewer = ({ dziUrl, filename }) => {
  const viewerRef = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [visibleAnnotations, setVisibleAnnotations] = useState({});
  const [annotationTypes, setAnnotationTypes] = useState([]);
  const [zoomValue, setZoomValue] = useState(0); // State to control zoom slider
  const [statistics, setStatistics] = useState([]); // State to store clustering statistics
  const pixiAppRef = useRef(null);
  const annotationGraphicsRef = useRef(null);
  const [annotationFile, setAnnotationFile] = useState(null); // Define annotation file state

  const initializePixiApp = () => {
    const canvas = document.createElement('canvas');
    const view = canvas.transferControlToOffscreen();
  
    const app = new Application();
  
    app.init({
      view,
      backgroundAlpha: 0,  // Ensure the canvas is fully transparent
      resizeTo: viewerRef.current,  // Ensure the canvas resizes with the viewer
    }).then(() => {
      viewerRef.current.appendChild(canvas);  // Append the OffscreenCanvas to the viewer
      pixiAppRef.current = app;
  
      // Create the graphics container for annotations
      annotationGraphicsRef.current = new PIXI.Graphics();
      app.stage.addChild(annotationGraphicsRef.current);
    }).catch(err => console.error("PixiJS Initialization error: ", err));
  };

  // Add blur to the viewer
  const addBlur = () => {
    const viewerElement = document.getElementById('openseadragon-viewer');
    viewerElement.classList.add('blur');
  };

  const getViewportBounds = () => {
    if (!viewer) return null;
  
    // Get the current viewport rectangle in image coordinates
    const viewportRect = viewer.viewport.getBounds(true); // Get the viewport bounds in viewport coordinates
    const imageRect = viewer.viewport.viewportToImageRectangle(viewportRect); // Convert it to image coordinates
  
    return {
      xMin: imageRect.x,
      xMax: imageRect.x + imageRect.width,
      yMin: imageRect.y,
      yMax: imageRect.y + imageRect.height,
    };
  };
  
  const getVisibleAnnotations = (annotations) => {
    const bounds = getViewportBounds();
    if (!bounds) return [];
  
    return annotations.map((annotation) => {
      const { geometry } = annotation;
      if (!geometry || !geometry.coordinates) return null;
  
      let filteredGeometry = { ...geometry };
  
      if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
        // Filter Polygon or MultiPolygon coordinates to only those within the bounds
        filteredGeometry.coordinates = geometry.coordinates.map((polygon) => {
          return polygon.map((ring) => {
            return ring.filter(([x, y]) => {
              return (
                x >= bounds.xMin &&
                x <= bounds.xMax &&
                y >= bounds.yMin &&
                y <= bounds.yMax
              );
            });
          }).filter((ring) => ring.length > 0);
        }).filter((polygon) => polygon.length > 0);
      } else if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
        // Filter Point or MultiPoint coordinates to only those within the bounds
        filteredGeometry.coordinates = geometry.coordinates.filter(([x, y]) => {
          return (
            x >= bounds.xMin &&
            x <= bounds.xMax &&
            y >= bounds.yMin &&
            y <= bounds.yMax
          );
        });
      }
  
      return filteredGeometryHasData(filteredGeometry) ? { ...annotation, geometry: filteredGeometry } : null;
    }).filter((annotation) => annotation !== null);
  };
  
  // Helper function to check if filtered geometry still has valid data
  const filteredGeometryHasData = (geometry) => {
    if (!geometry.coordinates) return false;
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      return geometry.coordinates.length > 0 && geometry.coordinates.some(polygon => polygon.length > 0);
    }
    if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
      return geometry.coordinates.length > 0;
    }
    return false;
  };
  
  
  const removeBlur = () => {
    const viewerElement = document.getElementById('openseadragon-viewer');
    viewerElement.classList.remove('blur');
  };

  const showLoadingSpinner = () => {
    setLoadingStatus("Loading annotations...");
  };

  const hideLoadingSpinner = () => {
    setLoadingStatus("");
  };


  const handlePanZoomStart = () => {
    console.log('Pan/Zoom started');
    addBlur();
    showLoadingSpinner();
  };
  

  
  const clusterAnnotationsByType = (annotations) => {
    try {
      console.log("Starting clustering process...");
      showLoadingSpinner();
      addBlur();
  
      const typeClusterMap = {};
      annotationTypes.forEach((type) => {
        const annotationsOfType = annotations.filter(
          (annotation) => annotation.properties.classification.name === type
        );
  
        const points = annotationsOfType
          .map((annotation) => {
            const { geometry } = annotation;
            if (geometry && (geometry.type === 'Point' || geometry.type === 'MultiPoint')) {
              return geometry.coordinates;
            } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
              // Simplify MultiPolygon features to centroids
              return geometry.coordinates.map((polygon) => {
                const ring = polygon[0];
                const centroid = ring.reduce(
                  (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
                  [0, 0]
                ).map((sum) => sum / ring.length);
                return centroid;
              });
            }
            return null;
          })
          .flat()
          .filter((coord) => coord !== null);
  
        console.log(`Found ${points.length} points for type ${type}`);
  
        const sampledPoints = points.filter((_, index) => index % 50 === 0);
        console.log(`Sampled ${sampledPoints.length} points for clustering`);
  
        // Run DBSCAN clustering with adjusted parameters
        const dbscan = new DBSCAN.DBSCAN();
        const clusters = dbscan.run(sampledPoints, 25, 1); //MULTIPOLYGON CALC
  
        console.log(`Clusters found for type ${type}:`, clusters);
  
        const clusteredAnnotations = clusters.map((cluster, index) => ({
          clusterId: `${type}-${index}`,
          points: cluster.map((pointIndex) => sampledPoints[pointIndex]),
          type,
        }));
  
        typeClusterMap[type] = clusteredAnnotations;
      });
  
      hideLoadingSpinner();
      removeBlur();
  
      return typeClusterMap;
  
    } catch (error) {
      console.error("Error during clustering process:", error);
      hideLoadingSpinner();
      removeBlur();
      return null;
    }
  };
  
  
  const ZOOM_THRESHOLD = 6.0;

  const drawAnnotationsWithPixi = () => {
    const visibleAnnotationsInViewport = getVisibleAnnotations(annotations);
    if (!viewer || !viewer.world || !pixiAppRef.current || !annotationGraphicsRef.current) return;
  
    setLoadingStatus("Drawing annotations...");
    const graphics = annotationGraphicsRef.current;
    graphics.clear(); // Clear previous drawings
  
    if (viewer.viewport.getZoom() <= ZOOM_THRESHOLD) {
      // Use precomputed clusters if they exist
      if (precomputedClusters) {
        console.log("Drawing clusters...");
  
        Object.keys(precomputedClusters).forEach((type) => {
          if (!visibleAnnotations[type]) return;
  
          const clusters = precomputedClusters[type];
          
          // Assign color based on the annotation type
          const color = annotations.find(
            (annotation) => annotation.properties.classification.name === type
          )?.properties.classification.color;
  
          if (!color) return;
  
          const hexColor = (color[0] << 16) + (color[1] << 8) + color[2];
  
          clusters.forEach((cluster) => {
            const clusterCentroid = cluster.points.reduce(
              (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
              [0, 0]
            ).map((sum) => sum / cluster.points.length);
  
            const [x, y] = clusterCentroid;
            const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
            const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  
            // Adjust cluster size to be smaller for better visualization
            const radius = Math.min(Math.max(cluster.points.length * 0.2, 3), 30);
            graphics.beginFill(hexColor, 0.8);
            graphics.drawCircle(screenPoint.x, screenPoint.y, radius);
            graphics.endFill();
          });
        });
      } else {
        console.warn("No clusters found for drawing.");
      }
    } else {
      console.log("Drawing individual points...");
      visibleAnnotationsInViewport.forEach((annotation) => {
        const { geometry, properties } = annotation;
        if (!geometry || !geometry.coordinates) return;
  
        const color = properties.classification.color;
        if (!color) return;
  
        const hexColor = (color[0] << 16) + (color[1] << 8) + color[2];
  
        if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
          geometry.coordinates.forEach(([x, y]) => {
            const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
            const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  
            graphics.beginFill(hexColor);
            graphics.drawCircle(screenPoint.x, screenPoint.y, 3);
            graphics.endFill();
          });
        } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
          // Draw each ring of the polygon/multi-polygon
          geometry.coordinates.forEach((polygon) => {
            polygon.forEach((ring) => {
              graphics.beginFill(hexColor, 0.6); // Use semi-transparent fill for polygons
              ring.forEach(([x, y], index) => {
                const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
                const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
                if (index === 0) {
                  graphics.moveTo(screenPoint.x, screenPoint.y);
                } else {
                  graphics.lineTo(screenPoint.x, screenPoint.y);
                }
              });
              graphics.closePath();
              graphics.endFill();
            });
          });
        }
      });
    }
  
    pixiAppRef.current.renderer.render(pixiAppRef.current.stage);
    setLoadingStatus(""); // Reset loading status after drawing
  };

  
  // Throttling function to improve rendering performance during interactions
  const throttle = (func, limit) => {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  };
  
  const handlePanZoomEnd = throttle(() => {
    removeBlur();
    hideLoadingSpinner();
    drawAnnotationsWithPixi(); // Re-draw annotations after zoom/pan ends
  }, 200); // Throttle clustering and rendering to avoid lag
  
  

  
  // Update the canvas size when the viewer resizes
  const updatePixiAppSize = () => {
    if (pixiAppRef.current && viewerRef.current) {
      const app = pixiAppRef.current;
      app.renderer.resize(viewerRef.current.clientWidth, viewerRef.current.clientHeight);
      drawAnnotationsWithPixi();
    }
  };

  useEffect(() => {
    if (viewer) {
      // Update zoom value continuously during zoom events
      const updateZoomValue = () => {
        const currentZoom = viewer.viewport.getZoom();
        setZoomValue(currentZoom);
      };
  
      viewer.addHandler('zoom', updateZoomValue);
      viewer.addHandler('animation', updateZoomValue);
      viewer.addHandler('animation-finish', updateZoomValue);
  
      return () => {
        viewer.removeHandler('zoom', updateZoomValue);
        viewer.removeHandler('animation', updateZoomValue);
        viewer.removeHandler('animation-finish', updateZoomValue);
      };
    }
  }, [viewer]);

  const [precomputedClusters, setPrecomputedClusters] = useState(null); // Store precomputed clusters

  const loadAndDisplayAnnotations = async (annotationFilename) => {
    try {
      console.log("Starting to load annotations...");
      showLoadingSpinner();
      addBlur();
  
      // Step 1: Load Annotations
      const response = await axios.get(`http://localhost:5000/annotations/${annotationFilename}`);
      const features = response.data;
  
      console.log("Annotations loaded.");
  
      setAnnotations(features);
  
      // Step 2: Compute Unique Types
      const uniqueTypes = [...new Set(features.map((feature) => feature.properties.classification.name))];
      setAnnotationTypes(uniqueTypes);
      setVisibleAnnotations(uniqueTypes.reduce((acc, type) => ({ ...acc, [type]: true }), {}));
  
      // Step 3: Compute Clusters Asynchronously
      console.log("Starting clustering process...");
      const computedClusters = await computeClustersAsync(features);
      if (computedClusters) {
        console.log("Clustering complete.");
        setPrecomputedClusters(computedClusters);
      } else {
        console.error("Clustering failed or no clusters were produced.");
      }
  
      // Step 4: Hide Loader/Blur and Update Rendering
      if (viewer) {
        updatePixiAppSize(); // Redraw annotations
      }
      hideLoadingSpinner();
      removeBlur();
  
    } catch (error) {
      console.error('Error loading annotations or clustering:', error);
      hideLoadingSpinner();
      removeBlur();
    }
  };
  const [loadingStatus, setLoadingStatus] = useState("");

  const computeClustersAsync = (annotations) => {
    return new Promise((resolve) => {
      setLoadingStatus("Clustering annotations...");
      const typeClusterMap = {};
      const newStatistics = [];

      annotationTypes.forEach((type) => {
        const annotationsOfType = annotations.filter(
          (annotation) => annotation.properties.classification.name === type
        );

        // Extract coordinates from annotations
        const points = annotationsOfType
          .map((annotation) => {
            const { geometry } = annotation;
            if (geometry && (geometry.type === 'Point' || geometry.type === 'MultiPoint')) {
              return geometry.coordinates;
            } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
              // Use all points from each polygon ring instead of calculating centroids
              return geometry.coordinates.flatMap((polygon) =>
                polygon.flatMap((ring) => ring)
              );
            }
            return null;
          })
          .flat()
          .filter((coord) => coord !== null);

        console.log(`Found ${points.length} points for type ${type}`);
        newStatistics.push({ type, points: points.length });

        // Ensure there are enough points for clustering
        if (points.length === 0) {
          console.warn(`No points available for type ${type}, skipping clustering.`);
          return;
        }

        // Sample the points to reduce the load for clustering
        const sampledPoints = points.filter((_, index) => index % 10 === 0);
        console.log(`Sampled ${sampledPoints.length} points for clustering for type ${type}`);
        newStatistics.push({ type, sampledPoints: sampledPoints.length });

        // Adjust DBSCAN parameters
        const epsilon = 25; // Adjust epsilon to reduce cluster size
        const minPoints = 1; // Adjust minPoints

        // Run DBSCAN clustering
        const dbscan = new DBSCAN.DBSCAN();
        const clusters = dbscan.run(sampledPoints, epsilon, minPoints);
        console.log(`Clusters found for type ${type}:`, clusters);
        newStatistics.push({ type, clusters: clusters.length });

        // Store clustered annotations
        const clusteredAnnotations = clusters.map((cluster, index) => ({
          clusterId: `${type}-${index}`,
          points: cluster.map((pointIndex) => sampledPoints[pointIndex]),
          type,
        }));

        typeClusterMap[type] = clusteredAnnotations;
      });

      setStatistics(newStatistics); // Update the statistics for display
      setLoadingStatus(""); // Reset loading status when clustering is complete
      resolve(typeClusterMap);
    });
  };
  
  
  
  
  
  
  

  // Toggle annotation visibility
  const handleToggleAnnotation = (type) => {
    setVisibleAnnotations((prevState) => ({
      ...prevState,
      [type]: !prevState[type],
    }));
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
        setZoomValue(newViewer.viewport.getZoom()); // Initialize slider with current zoom
        initializePixiApp();
      });
      newViewer.addHandler('animation-start', handlePanZoomStart);  // Trigger blur and spinner when zoom starts
      newViewer.addHandler('animation-finish', handlePanZoomEnd);  // Remove blur and spinner after the animation ends
  
      return () => {
        newViewer.removeHandler('animation-start', handlePanZoomStart);
        newViewer.removeHandler('animation-finish', handlePanZoomEnd);
      };
    }
  }, [dziUrl, viewer]);
  
  useEffect(() => {
    if (annotations.length > 0) {
      drawAnnotationsWithPixi();
    }
  }, [visibleAnnotations, annotations, zoomValue]);
  

  const handleZoomChange = (event) => {
    const zoomLevel = parseFloat(event.target.value);
    if (viewer) {
      viewer.viewport.zoomTo(zoomLevel);
    }
  };
  let animationFrameId = null;

const handlePanZoom = () => {
  if (animationFrameId) {
    // cancelAnimationFrame(animationFrameId);
  }
  animationFrameId = requestAnimationFrame(() => {
    drawAnnotationsWithPixi();
    animationFrameId = null;
  });
};

// Attach pan and zoom event handlers to the viewer
useEffect(() => {
  if (viewer) {
    viewer.addHandler('pan', handlePanZoom);
    viewer.addHandler('zoom', handlePanZoom);
    viewer.addHandler('animation', handlePanZoom);
    viewer.addHandler('animation-start', handlePanZoomStart);  // Trigger blur and spinner when zoom starts
    viewer.addHandler('animation-finish', handlePanZoomEnd);  // Remove blur and spinner after the animation ends

    return () => {
      viewer.removeHandler('pan', handlePanZoom);
      viewer.removeHandler('zoom', handlePanZoom);
      viewer.removeHandler('animation', handlePanZoom);
      viewer.removeHandler('animation-start', handlePanZoomStart);  // Trigger blur and spinner when zoom starts
      viewer.removeHandler('animation-finish', handlePanZoomEnd);  // Remove blur and spinner after the animation ends
    };
  }
}, [viewer, annotations, visibleAnnotations]);


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
      updatePixiAppSize(); // Ensure canvas and annotations are redrawn after upload
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
          {loadingStatus && (
            <div className="loading-overlay">
              <ClipLoader color={"#123abc"} loading={true} size={50} />
              <div className="loading-status">
                {loadingStatus}
                <div className="loading-statistics">
                  {statistics.map((stat, index) => (
                    <div key={index} className="stat-item">
                      <strong>{stat.type}:</strong><br />
                      {stat.points && `Points Found: ${stat.points}`}<br />
                      {stat.sampledPoints && `Sampled Points: ${stat.sampledPoints}`}<br />
                      {stat.clusters && `Clusters Found: ${stat.clusters}`}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
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
        {!annotationTypes.length > 0 && <>Please Upload Annotations!</>}
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