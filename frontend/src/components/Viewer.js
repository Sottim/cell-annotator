import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import axios from 'axios';
import * as PIXI from 'pixi.js';
import { Application } from 'pixi.js';
import './Viewer.css'; 
import DBSCAN from 'density-clustering';

const Viewer = ({ dziUrl, filename }) => {
  const viewerRef = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [annotationTypes, setAnnotationTypes] = useState([]);
  const [zoomValue, setZoomValue] = useState(0); 
  const pixiAppRef = useRef(null);
  const annotationGraphicsRef = useRef(null);
  const [annotations, setAnnotations] = useState([]); // Holds multiple annotation datasets
  const [visibleAnnotations, setVisibleAnnotations] = useState({}); // Track visibility for each annotation set
  const [precomputedClusters, setPrecomputedClusters] = useState({}); // Store clusters for each annotation set
  const [annotationFiles, setAnnotationFiles] = useState([]); // Store the uploaded annotation files
  
  const initializePixiApp = () => {
    const canvas = document.createElement('canvas');
    const view = canvas.transferControlToOffscreen();
  
    const app = new Application();
  
    app.init({
      view,
      backgroundAlpha: 0,  
      resizeTo: viewerRef.current, 
    }).then(() => {
      viewerRef.current.appendChild(canvas); 
      pixiAppRef.current = app;
      annotationGraphicsRef.current = new PIXI.Graphics();
      app.stage.addChild(annotationGraphicsRef.current);
    }).catch(err => console.error("PixiJS Initialization error: ", err));
  };

  const addBlur = () => {
    const viewerElement = document.getElementById('openseadragon-viewer');
    // viewerElement.classList.add('blur');
  };

  const getViewportBounds = () => {
    if (!viewer) return null;
  
    const viewportRect = viewer.viewport.getBounds(true); 
    const imageRect = viewer.viewport.viewportToImageRectangle(viewportRect); 
  
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
    setLoadingStatus("Loading annotations");
    setTimeout(() => {
      const spinnerContainer = document.getElementById('loadingSpinner');
      if (spinnerContainer) {
        spinnerContainer.style.display = 'block';
      }
    }, 0);
  };
  
  
  const hideLoadingSpinner = () => {
    setLoadingStatus("Loading annotations");
    const spinnerContainer = document.getElementById('loadingSpinner');
    if (spinnerContainer) {
      spinnerContainer.style.display = 'none';
    }
  };
  

  const handlePanZoomStart = () => {
    console.log('Pan/Zoom started');
    setLoadingStatus("Loading annotations...");
    addBlur();
    showLoadingSpinner();
  };
  

  const ZOOM_THRESHOLD = 6.0;

  const drawAnnotationsWithPixi = () => {
    if (!viewer || !viewer.world || !pixiAppRef.current || !annotationGraphicsRef.current) return;
  
    setLoadingStatus("Drawing annotations...");
    const graphics = annotationGraphicsRef.current;
    graphics.clear();
  
    // Get the visible annotations within the viewport bounds
    const getVisibleAnnotationsFromState = () => {
      const filteredAnnotations = [];
    
      annotations.forEach(({ filename, features }) => {
        if (!visibleAnnotations[filename]) return; // Skip if visibility info is not present for this file
    
        const visibleTypes = visibleAnnotations[filename];
        const visibleFeatures = features.filter(
          ({ properties }) => visibleTypes[properties.classification.name]
        );
    
        filteredAnnotations.push(...visibleFeatures);
      });
    
      return filteredAnnotations;
    };
    
    const visibleAnnotationsInViewport = getVisibleAnnotations(getVisibleAnnotationsFromState());
      
    annotations.forEach(({ filename, features }) => {
      if (!visibleAnnotations[filename]) return;
  
      const visibleAnnotationTypes = visibleAnnotations[filename];
  
      if (viewer.viewport.getZoom() <= ZOOM_THRESHOLD) {
        // Draw clusters if precomputed and available
        if (precomputedClusters[filename]) {
          Object.keys(precomputedClusters[filename]).forEach((type) => {
            if (!visibleAnnotationTypes[type]) return;
  
            const clusters = precomputedClusters[filename][type];
            const color = features.find(
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
              const radius = Math.min(Math.max(cluster.points.length * 0.2, 3), 30);
  
              graphics.beginFill(hexColor, 0.8);
              graphics.drawCircle(screenPoint.x, screenPoint.y, radius);
              graphics.endFill();
            });
          });
        }
      } else {
        // Draw individual points and polygons if zoomed in
        visibleAnnotationsInViewport.forEach((annotation) => {
          const { geometry, properties } = annotation;
          if (!geometry || !geometry.coordinates) return;
  
          const color = properties.classification.color;
          if (!color) return;
  
          const type = properties.classification.name;
          if (!visibleAnnotationTypes[type]) return;  // Check if the annotation type is visible
  
          const hexColor = (color[0] << 16) + (color[1] << 8) + color[2];
  
          if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
            // Draw points
            geometry.coordinates.forEach(([x, y]) => {
              const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
              const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  
              graphics.beginFill(hexColor);
              graphics.drawCircle(screenPoint.x, screenPoint.y, 3);
              graphics.endFill();
            });
          } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
            // Draw polygons
            geometry.coordinates.forEach((polygon) => {
              polygon.forEach((ring) => {
                graphics.beginFill(hexColor, 0.6); // Set fill color with transparency for polygons
                ring.forEach(([x, y], index) => {
                  const viewportPoint = viewer.viewport.imageToViewportCoordinates(x, y);
                  const screenPoint = viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
                  if (index === 0) {
                    graphics.moveTo(screenPoint.x, screenPoint.y);
                  } else {
                    graphics.lineTo(screenPoint.x, screenPoint.y);
                  }
                });
                graphics.closePath(); // Close the polygon path
                graphics.endFill();
              });
            });
          }
        });
      }
    });
  
    pixiAppRef.current.renderer.render(pixiAppRef.current.stage);
    setLoadingStatus("");
  };
  
  
  

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
    drawAnnotationsWithPixi(); 
  }, 200); 
  
    const updatePixiAppSize = () => {
    if (pixiAppRef.current && viewerRef.current) {
      const app = pixiAppRef.current;
      app.renderer.resize(viewerRef.current.clientWidth, viewerRef.current.clientHeight);
      drawAnnotationsWithPixi();
    }
  };

  function clearGraphics()
  {
    const graphics = annotationGraphicsRef.current;
    if(graphics)
    {graphics.clear(); 
    }
  }

  useEffect(() => {
    if (viewer) {
      const updateZoomValue = () => {
        const currentZoom = viewer.viewport.getZoom();
        setZoomValue(currentZoom);
      };
  
      viewer.addHandler('zoom', updateZoomValue);
      viewer.addHandler('animation', updateZoomValue);
      viewer.addHandler('animation', clearGraphics);
      viewer.addHandler('zoom', clearGraphics);
      viewer.addHandler('pan', clearGraphics);
      viewer.addHandler('animation-finish', updateZoomValue);
  
      return () => {
        viewer.removeHandler('zoom', updateZoomValue);
        viewer.removeHandler('animation', updateZoomValue);
        viewer.removeHandler('animation', clearGraphics);
        viewer.removeHandler('zoom', clearGraphics);
        viewer.removeHandler('pan', clearGraphics);
        viewer.removeHandler('animation-finish', updateZoomValue);
      };
    }
  }, [viewer]);

  const loadAndDisplayAnnotations = async (annotationFilename) => {
    try {
      console.log("Starting to load annotations...");
      showLoadingSpinner();
      addBlur();
      const response = await axios.get(`http://localhost:5000/annotations/${annotationFilename}`);
      const features = response.data;
  
      // Append the new annotations
      setAnnotations((prevAnnotations) => [...prevAnnotations, { filename: annotationFilename, features }]);
  
      // Update visibility for each annotation type of the new file
      const uniqueTypes = [...new Set(features.map((feature) => feature.properties.classification.name))];
      setVisibleAnnotations((prevVisible) => ({
        ...prevVisible,
        [annotationFilename]: uniqueTypes.reduce((acc, type) => ({ ...acc, [type]: true }), {}),
      }));
  
      setAnnotationTypes((prevTypes) => Array.from(new Set([...prevTypes, ...uniqueTypes])));
  
      console.log("Starting clustering process...");
      const computedClusters = await computeClustersAsync(features);
      if (computedClusters) {
        console.log("Clustering complete.");
        setPrecomputedClusters((prevClusters) => ({
          ...prevClusters,
          [annotationFilename]: computedClusters,
        }));
      } else {
        console.error("Clustering failed or no clusters were produced.");
      }
  
      if (viewer) {
        updatePixiAppSize();
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

  const computeClustersAsync = (features) => {
    return new Promise((resolve) => {
      setLoadingStatus("Clustering annotations...");
      const typeClusterMap = {};
      const uniqueTypes = [...new Set(features.map((feature) => feature.properties.classification.name))];
  
      uniqueTypes.forEach((type) => {
        const annotationsOfType = features.filter(
          (annotation) => annotation.properties.classification.name === type
        );
        const points = annotationsOfType
          .map((annotation) => {
            const { geometry } = annotation;
            if (geometry && (geometry.type === 'Point' || geometry.type === 'MultiPoint')) {
              return geometry.coordinates;
            } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
              return geometry.coordinates.flatMap((polygon) =>
                polygon.flatMap((ring) => ring)
              );
            }
            return null;
          })
          .flat()
          .filter((coord) => coord !== null);
  
        if (points.length === 0) {
          console.warn(`No points available for type ${type}, skipping clustering.`);
          return;
        }
  
        const sampledPoints = points.filter((_, index) => index % 10 === 0);
        console.log(`Sampled ${sampledPoints.length} points for clustering for type ${type}`);
  
        const epsilon = 25; // Adjust epsilon to reduce cluster size
        const minPoints = 1; // Adjust minPoints
  
        const dbscan = new DBSCAN.DBSCAN();
        const clusters = dbscan.run(sampledPoints, epsilon, minPoints);
        console.log(`Clusters found for type ${type}:`, clusters);
  
        const clusteredAnnotations = clusters.map((cluster, index) => ({
          clusterId: `${type}-${index}`,
          points: cluster.map((pointIndex) => sampledPoints[pointIndex]),
          type,
        }));
  
        typeClusterMap[type] = clusteredAnnotations;
      });
  
      setLoadingStatus("Loading Annotations");
      resolve(typeClusterMap);
    });
  };
  
  
  const handleToggleAnnotation = (filename, type) => {
    setVisibleAnnotations((prevState) => ({
      ...prevState,
      [filename]: {
        ...prevState[filename],
        [type]: !prevState[filename][type],
      },
    }));
  };
  
  useEffect(() => {
    if (viewerRef.current && !viewer) {
      const newViewer = OpenSeadragon({
        element: viewerRef.current,
        tileSources: dziUrl,
        showNavigationControl: false,
        maxZoomPixelRatio: 15, 
        minZoomImageRatio:1,
        minZoomLevel:1,
        visibilityRatio: 1.0, 
        constrainDuringPan: true, 
      });
  
      newViewer.addHandler('open', () => {
        setViewer(newViewer);
        newViewer.viewport.zoomTo(1);
        setZoomValue(newViewer.viewport.getZoom());
        initializePixiApp();
      });
      newViewer.addHandler('animation-start', handlePanZoomStart);  
      newViewer.addHandler('animation-finish', handlePanZoomEnd);  
  
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
  }, [visibleAnnotations, annotations, zoomValue, loadingStatus]);
  

  const handleZoomChange = (event) => {
    const zoomLevel = parseFloat(event.target.value);
    if (viewer) {
      viewer.viewport.zoomTo(zoomLevel);
    }
  };
  let animationFrameId = null;

const handlePanZoom = () => {
  if (animationFrameId) {
  }
  animationFrameId = requestAnimationFrame(() => {
    drawAnnotationsWithPixi();
    animationFrameId = null;
  });
};

useEffect(() => {
  if (viewer) {
    viewer.addHandler('pan', handlePanZoom);
    viewer.addHandler('zoom', handlePanZoom);
    viewer.addHandler('animation', handlePanZoom);
    viewer.addHandler('animation-start', handlePanZoomStart); 
    viewer.addHandler('animation-finish', handlePanZoomEnd);  

    return () => {
      viewer.removeHandler('pan', handlePanZoom);
      viewer.removeHandler('zoom', handlePanZoom);
      viewer.removeHandler('animation', handlePanZoom);
      viewer.removeHandler('animation-start', handlePanZoomStart); 
      viewer.removeHandler('animation-finish', handlePanZoomEnd); 
    };
  }
}, [viewer, annotations, visibleAnnotations]);


const handleAnnotationFileChange = (event) => {
  if (event.target.files && event.target.files.length > 0) {
    const filesArray = Array.from(event.target.files);
    setAnnotationFiles(filesArray); // Set files in state
  } else {
    console.warn("No files selected");
  }
};



const handleAnnotationUpload = async (file) => {
  if (!file) {
    alert('Please select an annotation file first!');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    await axios.post('http://localhost:5000/upload_annotations', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    await loadAndDisplayAnnotations(file.name);
  } catch (error) {
    console.error('Error uploading annotation file:', error);
  }
};

const handleMultipleAnnotationUpload = async () => {
  if (annotationFiles.length === 0) {
    alert('No files selected for upload.');
    return;
  }

  for (let file of annotationFiles) {
    await handleAnnotationUpload(file);
  }

  setAnnotationFiles([]); // Clear state after processing
};



  return (
    <div className="viewer-container">
      <div className="viewer-header">
        <h1>Whole Slide Image Viewer</h1>
      </div>
      <div className="viewer-wrapper">
        <div className="viewer-box">
          <div id="openseadragon-viewer" ref={viewerRef} className="wsi-viewer">
          <div className="loading-spinner-container" id="loadingSpinner" style={{ display: loadingStatus ? 'block' : 'none' }}>
          <div className="loading-spinner"></div>
          <div className="loading-status">{loadingStatus}...</div>
        </div>
          <div className="annotation-legend">
            
      <ul>
        {annotationTypes.map((type) => {
          let color = null;
          for (const { features } of annotations) {
            const feature = features.find((feature) => feature.properties.classification.name === type);
            if (feature) {
              color = feature.properties.classification.color;
              break;
            }
          }

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
        <div className="annotation-toggles">
  <h3>Toggle Annotations</h3>
  {annotations.length > 0 ? (
    annotations.map(({ filename, features }) => (
      <div key={filename}>
        <h4>{filename.substring(0,filename.length-8)}</h4>
        {Object.keys(visibleAnnotations[filename]).map((type) => (
          <div key={type}>
            <label>
              <input
                type="checkbox"
                checked={visibleAnnotations[filename][type]}
                onChange={() => handleToggleAnnotation(filename, type)}
              />
              {type}
            </label>
          </div>
        ))}
      </div>
    ))
  ) : (
    <p>Please Upload Annotations!</p>
  )}
</div>


        </div>
      </div>

      <div className="zoom-slider-container">
        Zoom Level
      <input
          id="zoomSlider"
          className="zoom-slider"
          type="range"
          min={1}
          max={10}
          step={1}
          value={Math.min(zoomValue, 10)}
          onChange={handleZoomChange}
        />
          <div className="zoom-levels">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i + 1} className="zoom-level">{i + 1}</span>
          ))}
                </div>
      </div>

<div className="upload-section">
  <input type="file" onChange={handleAnnotationFileChange} accept=".json,.geojson" multiple />
  <button onClick={handleMultipleAnnotationUpload} className="upload-btn">
    Upload Annotations
  </button>
</div>


    </div>
  );
};

export default Viewer;