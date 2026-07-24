import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import localforage from 'localforage';
import { Stage, Layer, Image as KonvaImage, Text as KonvaText, Rect, Group, Shape } from 'react-konva';
import { MousePointer2, Move, Type, Crop, Eraser, PenTool, Eye, EyeOff, Layers, ImageIcon, Zap, UploadCloud, Trash2, FolderOpen, Save, Download, X } from 'lucide-react';
import { readPsd } from 'ag-psd';
import './index.css';

function App() {
  const [activeTool, setActiveTool] = useState('move');
  const [psdData, setPsdData] = useState(null);
  const [layers, setLayers] = useState([]);
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState(() => localStorage.getItem('psd_bulkText') || '');
  const [selectedLayerId, setSelectedLayerId] = useState(() => localStorage.getItem('psd_selectedLayerId') || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  
  const [previewText, setPreviewText] = useState(null);
  const [bulkFontSize, setBulkFontSize] = useState(() => Number(localStorage.getItem('psd_bulkFontSize')) || 48);
  const [bulkColor, setBulkColor] = useState(() => localStorage.getItem('psd_bulkColor') || '#ffffff');

  useEffect(() => { localStorage.setItem('psd_bulkText', bulkText); }, [bulkText]);
  useEffect(() => { localStorage.setItem('psd_selectedLayerId', selectedLayerId); }, [selectedLayerId]);
  useEffect(() => { localStorage.setItem('psd_bulkFontSize', bulkFontSize.toString()); }, [bulkFontSize]);
  useEffect(() => { localStorage.setItem('psd_bulkColor', bulkColor); }, [bulkColor]);

  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const stageRef = useRef(null);

  const updateScale = () => {
    if (containerRef.current && psdData) {
      const containerW = Math.max(100, containerRef.current.clientWidth);
      const containerH = Math.max(100, containerRef.current.clientHeight);
      const scaleX = (containerW - 40) / (psdData.width || 1);
      const scaleY = (containerH - 40) / (psdData.height || 1);
      const minScale = Math.max(0.01, Math.min(scaleX, scaleY, 1));
      
      setScale(minScale);
      setStagePos({
        x: (containerW - (psdData.width || 0) * minScale) / 2,
        y: (containerH - (psdData.height || 0) * minScale) / 2
      });
    }
  };

  useEffect(() => {
    updateScale();
  }, [psdData]);

  useEffect(() => {
    const initApp = async () => {
      try {
        const savedBuffer = await localforage.getItem('saved_psd');
        if (savedBuffer) {
          await parsePsdBuffer(savedBuffer);
        }
      } catch (err) {
        console.error("Failed to load saved PSD", err);
      }
    };
    initApp();
  }, []);

  const handleOpenClick = () => {
    fileInputRef.current?.click();
  };

  const handleClearCache = async () => {
    if (window.confirm("Are you sure you want to clear the saved PSD and start over?")) {
      await localforage.removeItem('saved_psd');
      setPsdData(null);
      setLayers([]);
    }
  };

  const parsePsdBuffer = async (buffer) => {
    try {
      const psd = readPsd(buffer);
      
      setPsdData({
        width: psd.width,
        height: psd.height,
        channels: psd.channels,
        bitsPerChannel: psd.bitsPerChannel,
        colorMode: psd.colorMode
      });
      
      const flattenLayers = (node) => {
        let result = [];
        if (node.children) {
          node.children.forEach(child => {
            if (child.children) {
              result = result.concat(flattenLayers(child));
            } else {
              result.push(child);
            }
          });
        }
        return result;
      };

      const extracted = flattenLayers(psd);
      
      const layersWithId = await Promise.all(extracted.map(async (l, i) => {
        let imageElement = null;
        if (l.canvas) {
          await new Promise((resolve) => {
            imageElement = new window.Image();
            imageElement.onload = resolve;
            imageElement.onerror = resolve; 
            imageElement.src = l.canvas.toDataURL();
          });
        }
        
        return {
          ...l,
          imageElement,
          uniqueId: `layer-${i}`
        };
      }));
      
      setLayers(layersWithId.reverse());
    } catch (error) {
      console.error('Error parsing PSD:', error);
      alert('Failed to parse PSD file. See console for details.');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      await localforage.setItem('saved_psd', buffer);
      await parsePsdBuffer(buffer);
    } catch (error) {
      console.error(error);
    }
  };

  const toggleLayerVisibility = (index) => {
    const newLayers = [...layers];
    newLayers[index].hidden = !newLayers[index].hidden;
    setLayers(newLayers);
  };

  const handleGenerateZip = async () => {
    if (!selectedLayerId || !bulkText.trim()) {
      alert("Please select a target layer and provide some text.");
      return;
    }
    setIsGenerating(true);
    setGenerationProgress(0);
    
    try {
      const zip = new JSZip();
      const lines = bulkText.split('\n').filter(l => l.trim() !== '');
      const stage = stageRef.current;
      
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        setPreviewText(text);
        await new Promise(resolve => setTimeout(resolve, 150));
        const dataURL = stage.toDataURL({ pixelRatio: 1 });
        const base64Data = dataURL.replace(/^data:image\/png;base64,/, "");
        zip.file(`banner_${i + 1}.png`, base64Data, { base64: true });
        setGenerationProgress(Math.round(((i + 1) / lines.length) * 100));
      }
      setPreviewText(null);
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "generated_banners.zip");
      setShowBulkModal(false);
    } catch (error) {
      console.error("Error during generation:", error);
      alert("An error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const textLayers = layers.filter(l => l.text !== undefined || l.canvas !== undefined);

  return (
    <div className="app-container">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: '#fff', marginRight: '20px' }}>
          <Layers size={20} color="#007acc" />
          <span>PSD Editor + Bulk Automation</span>
        </div>
        <div className="topbar-menu">
          <span onClick={handleOpenClick}>File</span>
          <span onClick={() => setShowBulkModal(true)} style={{ color: '#ffb000', fontWeight: 'bold' }}>
            <Zap size={14} style={{ display: 'inline', verticalAlign: 'text-bottom' }}/> Bulk Generate
          </span>
        </div>
      </div>

      <div className="main-content">
        <div className="toolbar">
          <div className={`tool-button ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')}><MousePointer2 size={18} /></div>
          <div className={`tool-button ${activeTool === 'move' ? 'active' : ''}`} onClick={() => setActiveTool('move')}><Move size={18} /></div>
          <div className={`tool-button ${activeTool === 'text' ? 'active' : ''}`} onClick={() => setActiveTool('text')}><Type size={18} /></div>
        </div>

        <div className="canvas-area" ref={containerRef}>
          {!psdData ? (
            <div className="empty-state" onClick={handleOpenClick}>
              <div className="upload-icon-wrapper">
                <UploadCloud size={64} />
              </div>
              <h3>Upload a PSD File</h3>
              <p>Drag and drop or click to browse your files</p>
            </div>
          ) : (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <button 
                onClick={handleClearCache}
                style={{ position: 'absolute', top: 10, right: 10, zIndex: 100, display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 12px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
              >
                <Trash2 size={16} color="#ff4444" /> Clear Saved PSD
              </button>
              <div className="canvas-container" style={{ 
                width: psdData.width * scale, 
                height: psdData.height * scale,
                position: 'absolute',
                left: stagePos.x,
                top: stagePos.y,
                boxShadow: '0 0 20px rgba(0,0,0,0.8)'
              }}>
                <Stage width={Math.max(1, psdData.width * scale)} height={Math.max(1, psdData.height * scale)} scaleX={scale} scaleY={scale} ref={stageRef}>
                  <Layer>
                    {[...layers].reverse().map((layer) => {
                    if (layer.hidden) return null;
                    
                    // If this is the targeted text layer for bulk generation, render a KonvaText instead of the raster image
                    if (layer.uniqueId === selectedLayerId && previewText !== null) {
                      return (
                        <KonvaText
                          key={layer.uniqueId}
                          id={layer.uniqueId}
                          text={previewText}
                          x={layer.left || 0}
                          y={layer.top || 0}
                          fontSize={bulkFontSize}
                          fill={bulkColor}
                          fontFamily="sans-serif"
                          fontStyle="bold"
                          draggable={activeTool === 'move'}
                          onDragEnd={(e) => {
                            const updatedLayers = [...layers];
                            const targetLayer = updatedLayers.find(l => l.uniqueId === layer.uniqueId);
                            if (targetLayer) {
                              targetLayer.left = e.target.x();
                              targetLayer.top = e.target.y();
                              setLayers(updatedLayers);
                            }
                          }}
                        />
                      );
                    }
                    
                    if (layer.imageElement) {
                      const imgW = layer.imageElement.width || (layer.right - layer.left) || 1;
                      const imgH = layer.imageElement.height || (layer.bottom - layer.top) || 1;
                      
                      return (
                        <Group 
                          key={layer.uniqueId}
                          x={layer.left || 0}
                          y={layer.top || 0}
                          draggable={activeTool === 'move'}
                          onDragEnd={(e) => {
                            const updatedLayers = [...layers];
                            const targetLayer = updatedLayers.find(l => l.uniqueId === layer.uniqueId);
                            if (targetLayer) {
                              targetLayer.left = e.target.x();
                              targetLayer.top = e.target.y();
                              setLayers(updatedLayers);
                            }
                          }}
                        >
                          <Shape
                            sceneFunc={(context, shape) => {
                              if (layer.imageElement) {
                                // Draw directly to the raw canvas context
                                context.drawImage(layer.imageElement, 0, 0, imgW, imgH);
                              }
                              context.fillStrokeShape(shape);
                            }}
                            width={imgW}
                            height={imgH}
                          />
                        </Group>
                      );
                    }
                    return null;
                  })}
                </Layer>
              </Stage>
            </div>
            </div>
          )}
        </div>

        <div className="right-panel">
          <div className="panel-header">Layers</div>
          <div className="layer-list">
            {layers.map((layer, index) => (
              <div key={layer.uniqueId} className="layer-item">
                <div style={{ cursor: 'pointer' }} onClick={() => toggleLayerVisibility(index)}>
                  {!layer.hidden ? <Eye size={16} /> : <EyeOff size={16} color="#666" />}
                </div>
                {layer.text ? <Type size={14} color="#aaa" /> : <ImageIcon size={14} color="#aaa" />}
                <div style={{ flex: 1, userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {layer.name}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px', display: 'flex', gap: '8px', justifyContent: 'center', backgroundColor: '#333' }}>
             <input type="file" accept=".psd" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
             <button className="btn-primary" style={{ width: '100%' }} onClick={() => setShowBulkModal(true)}>
               <Zap size={16} /> Bulk Generate
             </button>
          </div>
        </div>
      </div>

      {/* Bulk Generation Modal */}
      {showBulkModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <span>Bulk Banner Generation</span>
              <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowBulkModal(false)} />
            </div>
            
            <div className="modal-body">
              <label style={{ fontSize: '14px', color: '#ccc' }}>1. Select the Text Layer to replace:</label>
              <select 
                className="layer-select"
                value={selectedLayerId}
                onChange={(e) => setSelectedLayerId(e.target.value)}
              >
                <option value="">-- Choose a layer --</option>
                {textLayers.map(l => (
                  <option key={l.uniqueId} value={l.uniqueId}>{l.name}</option>
                ))}
              </select>

              <label style={{ fontSize: '14px', color: '#ccc', marginTop: '10px' }}>
                2. Paste your new texts (one per line):
              </label>
              <textarea 
                className="bulk-input"
                placeholder="Sale 50% Off!\nNew Arrivals\nSummer Collection"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />

              {selectedLayerId && (
                <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: '#ccc', display: 'block', marginBottom: '4px' }}>Font Size (px):</label>
                    <input type="number" value={bulkFontSize} onChange={e => setBulkFontSize(Number(e.target.value))} style={{ width: '100%', padding: '6px' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: '#ccc', display: 'block', marginBottom: '4px' }}>Color:</label>
                    <input type="color" value={bulkColor} onChange={e => setBulkColor(e.target.value)} style={{ width: '100%', padding: '2px', height: '32px' }} />
                  </div>
                </div>
              )}

              <button 
                className="btn-primary" 
                style={{ marginTop: '10px' }} 
                onClick={handleGenerateZip}
                disabled={isGenerating}
              >
                {isGenerating ? `Generating... ${generationProgress}%` : 'Generate & Download Zip'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
