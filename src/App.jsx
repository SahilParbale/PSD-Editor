import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import localforage from 'localforage';
import { Stage, Layer, Image as KonvaImage, Text as KonvaText, Rect, Group, Shape, Transformer, Line as KonvaLine } from 'react-konva';
import Konva from 'konva';
import { MousePointer2, Move, Type, Crop, Eraser, PenTool, Eye, EyeOff, Layers, ImageIcon, Zap, UploadCloud, Trash2, FolderOpen, Save, Download, FileText, X, Copy, Palette, Undo, Redo, ZoomIn, ZoomOut, Menu } from 'lucide-react';
import { readPsd, writePsdUint8Array } from 'ag-psd';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './index.css';

function SortableLayerItem({ layer, index, selectedNodeId, setSelectedNodeId, setHoveredLayerId, toggleLayerVisibility, duplicateLayer, deleteLayer }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: layer.uniqueId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className={`layer-item ${selectedNodeId === layer.uniqueId ? 'active' : ''}`}
      onClick={() => setSelectedNodeId(layer.uniqueId)}
      onMouseEnter={() => setHoveredLayerId(layer.uniqueId)}
      onMouseLeave={() => setHoveredLayerId(null)}
    >
      <div style={{ cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(index); }}>
        {!layer.hidden ? <Eye size={16} /> : <EyeOff size={16} color="#666" />}
      </div>
      
      <div style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
        {layer.text ? (
          <div style={{ color: layer.editableFill || layer.text.fill || 'var(--text-light)', fontSize: '14px', fontWeight: 'bold' }}>T</div>
        ) : layer.imageElement ? (
          <img src={layer.imageElement.src} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} alt="thumb" draggable="false" />
        ) : (
          <ImageIcon size={14} color="var(--text-main)" />
        )}
      </div>

      <div style={{ flex: 1, userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {layer.name}
      </div>
      <div style={{ display: 'flex', gap: '4px' }} onPointerDown={(e) => e.stopPropagation()}>
        <Copy size={14} style={{ cursor: 'pointer', color: 'var(--text-main)' }} onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.uniqueId); }} />
        <Trash2 size={14} style={{ cursor: 'pointer', color: '#ff4444' }} onClick={(e) => { e.stopPropagation(); deleteLayer(layer.uniqueId); }} />
      </div>
    </div>
  );
}

const IMAGE_FILTERS = [Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.Blur];
const NO_FILTERS = [];

const getLayerFontData = (layer) => {
  let fontSize = 48;
  let fill = '#ffffff';
  let fontFamily = 'sans-serif';

  if (layer && layer.text) {
    const style = layer.text.style || (layer.text.styleRuns && layer.text.styleRuns[0]?.style);
    if (style) {
      if (style.fontSize) fontSize = style.fontSize;
      if (style.fillColor && 'r' in style.fillColor) {
        const r = Math.round(style.fillColor.r).toString(16).padStart(2, '0');
        const g = Math.round(style.fillColor.g).toString(16).padStart(2, '0');
        const b = Math.round(style.fillColor.b).toString(16).padStart(2, '0');
        fill = `#${r}${g}${b}`;
      }
      if (style.font?.name) {
        const name = style.font.name.toLowerCase();
        if (name.includes('arial')) fontFamily = 'Arial';
        else if (name.includes('times')) fontFamily = 'Times New Roman';
        else if (name.includes('courier')) fontFamily = 'Courier New';
        else if (name.includes('helvetica')) fontFamily = 'Helvetica';
        else if (name.includes('verdana')) fontFamily = 'Verdana';
        else if (name.includes('georgia')) fontFamily = 'Georgia';
        else if (name.includes('garamond')) fontFamily = 'Garamond';
        else if (name.includes('impact')) fontFamily = 'Impact';
        else if (name.includes('comic')) fontFamily = 'Comic Sans MS';
        else if (name.includes('trebuchet')) fontFamily = 'Trebuchet MS';
        else if (name.includes('palatino')) fontFamily = 'Palatino';
      }
    }
  }
  return { fontSize, fill, fontFamily };
};

const FilteredImage = React.memo(({ layer, imgW, imgH }) => {
  const imageRef = useRef(null);

  const hasFilters = (layer.brightness || 0) !== 0 || (layer.contrast || 0) !== 0 || (layer.blur || 0) !== 0;

  useEffect(() => {
    if (imageRef.current) {
      // Always clear cache first when properties or image change
      imageRef.current.clearCache();
      if (hasFilters) {
        imageRef.current.cache();
      }
    }
  }, [layer.brightness, layer.contrast, layer.blur, hasFilters, layer.imageElement]);

  return (
    <KonvaImage
      ref={imageRef}
      image={layer.imageElement}
      width={imgW}
      height={imgH}
      filters={hasFilters ? IMAGE_FILTERS : NO_FILTERS}
      brightness={layer.brightness || 0}
      contrast={layer.contrast || 0}
      blurRadius={layer.blur || 0}
    />
  );
});

function App() {
  const [activeTool, setActiveTool] = useState('move');
  const [psdData, setPsdData] = useState(null);
  const [layers, setLayers] = useState([]);
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [selectedLayerId, setSelectedLayerId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  
  const [previewText, setPreviewText] = useState(null);
  const [bulkFontSize, setBulkFontSize] = useState(48);
  const [bulkColor, setBulkColor] = useState('#ffffff');
  const [bulkFontFamily, setBulkFontFamily] = useState('sans-serif');

  // Canvas interaction states
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredLayerId, setHoveredLayerId] = useState(null);
  const trRef = useRef(null);
  
  // Drawing states
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [brushSize, setBrushSize] = useState(5);
  const isDrawing = useRef(false);

  // History states
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const isHistoryUpdate = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (isHistoryUpdate.current) {
      isHistoryUpdate.current = false;
      return;
    }
    if (layers.length === 0) return;

    const timer = setTimeout(() => {
      const hist = historyRef.current;
      const idx = historyIndexRef.current;
      if (hist.length > 0 && hist[idx] === layers) return;

      const newHist = hist.slice(0, idx + 1);
      newHist.push(layers);
      if (newHist.length > 50) newHist.shift();
      
      historyRef.current = newHist;
      historyIndexRef.current = newHist.length - 1;
      
      setHistoryVersion(v => v + 1);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [layers]);

  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      isHistoryUpdate.current = true;
      historyIndexRef.current -= 1;
      setLayers(historyRef.current[historyIndexRef.current]);
      setHistoryVersion(v => v + 1);
      setSelectedNodeId(null);
    }
  };

  const handleRedo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isHistoryUpdate.current = true;
      historyIndexRef.current += 1;
      setLayers(historyRef.current[historyIndexRef.current]);
      setHistoryVersion(v => v + 1);
      setSelectedNodeId(null);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setLayers((items) => {
        const oldIndex = items.findIndex(item => item.uniqueId === active.id);
        const newIndex = items.findIndex(item => item.uniqueId === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Layout resizing states
  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  // Sync bulk settings when a layer is selected in the bulk modal
  useEffect(() => {
    if (selectedLayerId) {
      const layer = layers.find(l => l.uniqueId === selectedLayerId);
      if (layer) {
        const { fontSize, fill, fontFamily } = getLayerFontData(layer);
        setBulkFontSize(layer.editableFontSize || fontSize);
        setBulkColor(layer.editableFill || fill);
        setBulkFontFamily(layer.editableFontFamily || fontFamily);
      }
    }
  }, [selectedLayerId]);

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
  }, [psdData, leftPanelWidth, rightPanelWidth]);

  // Handle panel resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingLeft) {
        // Toolbar is 50px wide
        const newWidth = Math.max(150, Math.min(500, e.clientX - 50));
        setLeftPanelWidth(newWidth);
      }
      if (isResizingRight) {
        const newWidth = Math.max(150, Math.min(500, window.innerWidth - e.clientX));
        setRightPanelWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    if (isResizingLeft || isResizingRight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      // Disable text selection while resizing
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.userSelect = 'auto';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'auto';
    };
  }, [isResizingLeft, isResizingRight]);

  // Attach transformer to selected node
  useEffect(() => {
    if (selectedNodeId && trRef.current && stageRef.current) {
      const node = stageRef.current.findOne('#' + selectedNodeId);
      if (node) {
        trRef.current.nodes([node]);
        trRef.current.getLayer().batchDraw();
      }
    }
  }, [selectedNodeId]);

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
      let buffer;

      if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') {
        const img = new window.Image();
        const objUrl = URL.createObjectURL(file);
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = objUrl;
        });
        
        URL.revokeObjectURL(objUrl);
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const psdObject = {
          width: canvas.width,
          height: canvas.height,
          channels: 3,
          bitsPerChannel: 8,
          colorMode: 3, // RGB
          children: [
            {
              name: file.name,
              canvas: canvas,
              opacity: 255,
              blendMode: 'normal',
              left: 0,
              top: 0,
              right: canvas.width,
              bottom: canvas.height
            }
          ]
        };
        
        buffer = writePsdUint8Array(psdObject).buffer;
      } else {
        buffer = await file.arrayBuffer();
      }

      await localforage.setItem('saved_psd', buffer);
      await parsePsdBuffer(buffer);
    } catch (error) {
      console.error(error);
      alert('Failed to process uploaded file.');
    }
  };

  const toggleLayerVisibility = (index) => {
    const newLayers = [...layers];
    newLayers[index].hidden = !newLayers[index].hidden;
    setLayers(newLayers);
  };

  const duplicateLayer = (id) => {
    const layerIndex = layers.findIndex(l => l.uniqueId === id);
    if (layerIndex === -1) return;
    const newLayer = { ...layers[layerIndex], uniqueId: Math.random().toString(36).substr(2, 9), name: layers[layerIndex].name + ' copy' };
    const newLayers = [...layers];
    newLayers.splice(layerIndex, 0, newLayer);
    setLayers(newLayers);
    setSelectedNodeId(newLayer.uniqueId);
  };

  const deleteLayer = (id) => {
    setLayers(layers.filter(l => l.uniqueId !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const handleExportPNG = () => {
    if (!stageRef.current) return;
    const prevHover = hoveredLayerId;
    const prevSelect = selectedNodeId;
    setHoveredLayerId(null);
    setSelectedNodeId(null);
    setTimeout(() => {
      if (stageRef.current) {
        const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
        saveAs(dataURL, "export.png");
      }
      setHoveredLayerId(prevHover);
      setSelectedNodeId(prevSelect);
    }, 100);
  };

  const handleExportPDF = () => {
    if (!stageRef.current) return;
    const prevHover = hoveredLayerId;
    const prevSelect = selectedNodeId;
    setHoveredLayerId(null);
    setSelectedNodeId(null);
    setTimeout(() => {
      if (stageRef.current) {
        const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
        const width = psdData ? psdData.width : stageRef.current.width();
        const height = psdData ? psdData.height : stageRef.current.height();
        
        const pdf = new jsPDF({
          orientation: width > height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [width, height]
        });
        
        pdf.addImage(dataURL, 'PNG', 0, 0, width, height);
        pdf.save("export.pdf");
      }
      setHoveredLayerId(prevHover);
      setSelectedNodeId(prevSelect);
    }, 100);
  };

  const handleReplaceImageClick = (layerId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new window.Image();
        img.onload = () => {
          isHistoryUpdate.current = true;
          setLayers(prev => prev.map(l => {
            if (l.uniqueId === layerId) {
              return { ...l, imageElement: img, canvas: undefined };
            }
            return l;
          }));
          setHistoryVersion(v => v + 1);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const closeBulkModal = () => {
    setBulkText('');
    setSelectedLayerId('');
    setBulkFontSize(48);
    setBulkColor('#ffffff');
    setBulkFontFamily('sans-serif');
    setShowBulkModal(false);
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
        const dataURL = stage.toDataURL({ pixelRatio: 2 }); // Use higher quality for PDF
        const width = psdData ? psdData.width : stage.width();
        const height = psdData ? psdData.height : stage.height();
        
        const pdf = new jsPDF({
          orientation: width > height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [width, height]
        });
        
        pdf.addImage(dataURL, 'PNG', 0, 0, width, height);
        const pdfBlob = pdf.output('blob');
        zip.file(`banner_${i + 1}.pdf`, pdfBlob);
        
        setGenerationProgress(Math.round(((i + 1) / lines.length) * 100));
      }
      setPreviewText(null);
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "generated_banners.zip");
      closeBulkModal();
    } catch (error) {
      console.error("Error during generation:", error);
      alert("An error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const textLayers = layers.filter(l => l.text !== undefined || l.canvas !== undefined);

  const handleStagePointerDown = (e) => {
    if (activeTool === 'brush' || activeTool === 'eraser') {
      if (!selectedNodeId) {
        alert("Please select a layer from the right panel to draw on.");
        return;
      }
      isDrawing.current = true;
      const stage = e.target.getStage();
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const targetLayer = layers.find(l => l.uniqueId === selectedNodeId);
      if (!targetLayer) return;

      const transform = stage.getAbsoluteTransform().copy().invert();
      const localPos = transform.point(pos);
      const layerX = localPos.x - (targetLayer.left || 0);
      const layerY = localPos.y - (targetLayer.top || 0);

      const newLine = {
        tool: activeTool,
        color: brushColor,
        size: brushSize,
        points: [layerX, layerY]
      };
      
      setLayers(prev => prev.map(l => {
        if (l.uniqueId === selectedNodeId) {
          return { ...l, lines: [...(l.lines || []), newLine] };
        }
        return l;
      }));
    } else {
      const clickedOnEmpty = e.target === e.target.getStage();
      if (clickedOnEmpty) {
        setSelectedNodeId(null);
      }
    }
  };

  const handleStagePointerMove = (e) => {
    if (!isDrawing.current || (activeTool !== 'brush' && activeTool !== 'eraser') || !selectedNodeId) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const localPos = transform.point(pos);
    const targetLayer = layers.find(l => l.uniqueId === selectedNodeId);
    if (!targetLayer) return;
    const layerX = localPos.x - (targetLayer.left || 0);
    const layerY = localPos.y - (targetLayer.top || 0);

    setLayers(prev => prev.map(l => {
      if (l.uniqueId === selectedNodeId) {
        const lines = [...(l.lines || [])];
        const lastLine = { ...lines[lines.length - 1] };
        lastLine.points = lastLine.points.concat([layerX, layerY]);
        lines[lines.length - 1] = lastLine;
        return { ...l, lines };
      }
      return l;
    }));
  };

  const handleStagePointerUp = () => {
    isDrawing.current = false;
  };

  return (
    <div className="app-container">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: 'var(--text-light)', marginRight: '20px' }}>
          <img src="/logo.png" alt="Psdify Logo" style={{ width: '44px', height: '44px', borderRadius: '6px', objectFit: 'cover' }} />
          <span style={{ fontSize: '24px', letterSpacing: '0.5px' }}>Psdify</span>
        </div>
        <div className="topbar-menu" style={{ alignItems: 'center' }}>
          
          <button 
            onClick={handleExportPNG} 
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-panel)', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '13px' }}
          >
            <Download size={14} /> Export PNG
          </button>

          <button 
            onClick={handleExportPDF} 
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-panel)', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '13px' }}
          >
            <FileText size={14} /> Export PDF
          </button>
          
          <button 
            onClick={() => setShowBulkModal(true)} 
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '13px', boxShadow: '0 2px 4px rgba(0,122,204,0.2)' }}
          >
            <Zap size={14} /> Bulk Generate
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="toolbar">
          <div className={`tool-button ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')}><MousePointer2 size={18} /></div>
          <div className={`tool-button ${activeTool === 'move' ? 'active' : ''}`} onClick={() => setActiveTool('move')}><Move size={18} /></div>
          <div className={`tool-button ${activeTool === 'text' ? 'active' : ''}`} onClick={() => setActiveTool('text')}><Type size={18} /></div>
          <div className={`tool-button ${activeTool === 'brush' ? 'active' : ''}`} onClick={() => setActiveTool('brush')}><PenTool size={18} /></div>
          <div className={`tool-button ${activeTool === 'eraser' ? 'active' : ''}`} onClick={() => setActiveTool('eraser')}><Eraser size={18} /></div>
          <div style={{ height: '1px', width: '24px', background: 'var(--border-color)', margin: '8px 0' }}></div>
          <div className={`tool-button ${historyIndexRef.current <= 0 ? 'disabled' : ''}`} onClick={handleUndo} style={{ opacity: historyIndexRef.current <= 0 ? 0.3 : 1 }}><Undo size={18} /></div>
          <div className={`tool-button ${historyIndexRef.current >= historyRef.current.length - 1 ? 'disabled' : ''}`} onClick={handleRedo} style={{ opacity: historyIndexRef.current >= historyRef.current.length - 1 ? 0.3 : 1 }}><Redo size={18} /></div>
          <div className="mobile-only-btn tool-button" onClick={() => setShowMobilePanel(!showMobilePanel)}><Layers size={18} /></div>
        </div>

        {selectedNodeId && (
          <>
            <div className="left-panel" style={{ width: leftPanelWidth, backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Properties</span>
                <X size={14} style={{ cursor: 'pointer' }} onClick={() => setSelectedNodeId(null)} />
              </div>

              {(activeTool === 'brush' || activeTool === 'eraser') && (
                <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-dark)' }}>
                  <div style={{ color: '#ffb000', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>
                    {activeTool === 'brush' ? 'Brush Settings' : 'Eraser Settings'}
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Size</label>
                      <input type="range" min="1" max="100" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} style={{ width: '100%' }} />
                    </div>
                    {activeTool === 'brush' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Color</label>
                        <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} style={{ width: '100%', height: '28px', background: 'transparent', border: 'none', cursor: 'pointer' }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ color: 'var(--text-light)', fontSize: '13px', fontWeight: 'bold', wordBreak: 'break-all' }}>
                  {layers.find(l => l.uniqueId === selectedNodeId)?.name || 'Selected Layer'}
                </div>
                {!layers.find(l => l.uniqueId === selectedNodeId)?.text && (
                  <button 
                    className="btn-primary" 
                    style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
                    onClick={() => handleReplaceImageClick(selectedNodeId)}
                  >
                    <UploadCloud size={12} /> Replace
                  </button>
                )}
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Opacity</label>
                <input 
                  type="range" 
                  min="0" max="1" step="0.01"
                  value={layers.find(l => l.uniqueId === selectedNodeId)?.opacity ?? 1} 
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setLayers(prev => prev.map(l => 
                      l.uniqueId === selectedNodeId ? { ...l, opacity: val } : l
                    ));
                  }}
                  style={{ width: '100%' }} 
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Blend Mode</label>
                <select
                  value={layers.find(l => l.uniqueId === selectedNodeId)?.blendMode ?? 'source-over'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLayers(prev => prev.map(l => 
                      l.uniqueId === selectedNodeId ? { ...l, blendMode: val } : l
                    ));
                  }}
                  style={{ width: '100%', background: 'var(--bg-toolbar)', color: 'var(--text-light)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px' }}
                >
                  <option value="source-over">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                  <option value="color-dodge">Color Dodge</option>
                  <option value="color-burn">Color Burn</option>
                  <option value="hard-light">Hard Light</option>
                  <option value="soft-light">Soft Light</option>
                  <option value="difference">Difference</option>
                  <option value="exclusion">Exclusion</option>
                  <option value="hue">Hue</option>
                  <option value="saturation">Saturation</option>
                  <option value="color">Color</option>
                  <option value="luminosity">Luminosity</option>
                </select>
              </div>

              {!layers.find(l => l.uniqueId === selectedNodeId)?.text && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <div style={{ color: 'var(--text-light)', fontSize: '12px', fontWeight: 'bold' }}>Image Adjustments</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Brightness</label>
                    <input type="range" min="-1" max="1" step="0.05" value={layers.find(l => l.uniqueId === selectedNodeId)?.brightness ?? 0} onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setLayers(prev => prev.map(l => l.uniqueId === selectedNodeId ? { ...l, brightness: val } : l));
                    }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Contrast</label>
                    <input type="range" min="-100" max="100" step="1" value={layers.find(l => l.uniqueId === selectedNodeId)?.contrast ?? 0} onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setLayers(prev => prev.map(l => l.uniqueId === selectedNodeId ? { ...l, contrast: val } : l));
                    }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Blur</label>
                    <input type="range" min="0" max="40" step="1" value={layers.find(l => l.uniqueId === selectedNodeId)?.blur ?? 0} onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setLayers(prev => prev.map(l => l.uniqueId === selectedNodeId ? { ...l, blur: val } : l));
                    }} />
                  </div>
                </div>
              )}
              
              {layers.find(l => l.uniqueId === selectedNodeId)?.text && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <div style={{ color: 'var(--text-light)', fontSize: '12px', fontWeight: 'bold' }}>Text Properties</div>
                  
                  <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Content</label>
                  <textarea 
                    rows={3} 
                    value={layers.find(l => l.uniqueId === selectedNodeId).editableText ?? layers.find(l => l.uniqueId === selectedNodeId).text.text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLayers(prev => prev.map(l => l.uniqueId === selectedNodeId ? { 
                        ...l, 
                        editableText: val,
                        editableFontSize: l.editableFontSize || 48,
                        editableFill: l.editableFill || '#ffffff'
                      } : l));
                    }}
                    style={{ width: '100%', background: 'var(--bg-toolbar)', color: 'var(--text-light)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px', resize: 'vertical' }}
                  />
                  
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Font Size</label>
                      <input 
                        type="number" 
                        value={layers.find(l => l.uniqueId === selectedNodeId).editableFontSize || getLayerFontData(layers.find(l => l.uniqueId === selectedNodeId)).fontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setLayers(prev => prev.map(l => l.uniqueId === selectedNodeId ? {
                            ...l,
                            editableFontSize: val,
                            editableText: l.editableText ?? l.text.text
                          } : l));
                        }}
                        style={{ width: '100%', background: 'var(--bg-toolbar)', color: 'var(--text-light)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Color</label>
                      <input 
                        type="color" 
                        value={layers.find(l => l.uniqueId === selectedNodeId).editableFill || getLayerFontData(layers.find(l => l.uniqueId === selectedNodeId)).fill}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLayers(prev => prev.map(l => l.uniqueId === selectedNodeId ? {
                            ...l,
                            editableFill: val,
                            editableText: l.editableText ?? l.text.text
                          } : l));
                        }}
                        style={{ width: '100%', height: '28px', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-main)' }}>Font Family</label>
                    <select 
                      value={layers.find(l => l.uniqueId === selectedNodeId).editableFontFamily || getLayerFontData(layers.find(l => l.uniqueId === selectedNodeId)).fontFamily}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLayers(prev => prev.map(l => l.uniqueId === selectedNodeId ? {
                          ...l,
                          editableFontFamily: val,
                          editableText: l.editableText ?? l.text.text
                        } : l));
                      }}
                      style={{ width: '100%', background: 'var(--bg-toolbar)', color: 'var(--text-light)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px' }}
                    >
                      <option value="sans-serif">Sans Serif</option>
                      <option value="serif">Serif</option>
                      <option value="monospace">Monospace</option>
                      <option value="Arial">Arial</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Courier New">Courier</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Palatino">Palatino</option>
                      <option value="Garamond">Garamond</option>
                      <option value="Comic Sans MS">Comic Sans</option>
                      <option value="Trebuchet MS">Trebuchet MS</option>
                      <option value="Arial Black">Arial Black</option>
                      <option value="Impact">Impact</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div 
            onMouseDown={() => setIsResizingLeft(true)} 
            style={{ width: '12px', cursor: 'col-resize', backgroundColor: isResizingLeft ? 'var(--accent)' : 'transparent', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--border-color)', transition: 'background-color 0.2s' }} 
          >
            <div style={{ width: '4px', height: '24px', backgroundColor: 'var(--border-color)', borderRadius: '2px' }} />
          </div>
        </>
      )}

        <div className="canvas-area" ref={containerRef} style={{ minWidth: 0 }}>
          {layers.length === 0 ? (
            <div className="empty-state" onClick={handleOpenClick} style={{ color: 'var(--text-main)', textAlign: 'center' }}>
              <div className="upload-icon-wrapper" style={{ display: 'inline-block', padding: '20px', backgroundColor: 'var(--bg-toolbar)', borderRadius: '50%', boxShadow: 'var(--shadow)', marginBottom: '16px' }}>
                <UploadCloud size={64} color="var(--accent)" />
              </div>
              <h3 style={{ color: 'var(--text-light)', marginBottom: '8px' }}>Upload a PSD or Image</h3>
              <p>Supports .psd, .png, .jpg, .webp</p>
            </div>
          ) : (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <div className="floating-zoom-controls">
                <button className="zoom-btn" onClick={() => setScale(s => Math.min(s * 1.2, 5))}><ZoomIn size={20} /></button>
                <button className="zoom-btn" onClick={() => setScale(s => Math.max(s / 1.2, 0.1))}><ZoomOut size={20} /></button>
              </div>
              <button 
                onClick={handleClearCache}
                style={{ position: 'absolute', top: 10, right: 10, zIndex: 100, display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 12px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-light)', borderRadius: '4px', cursor: 'pointer', boxShadow: 'var(--shadow)' }}
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
                <Stage 
                  width={Math.max(1, psdData.width * scale)} 
                  height={Math.max(1, psdData.height * scale)} 
                  scaleX={scale} 
                  scaleY={scale} 
                  ref={stageRef}
                  onMouseDown={handleStagePointerDown}
                  onTouchStart={handleStagePointerDown}
                  onMouseMove={handleStagePointerMove}
                  onTouchMove={handleStagePointerMove}
                  onMouseUp={handleStagePointerUp}
                  onTouchEnd={handleStagePointerUp}
                  onMouseLeave={handleStagePointerUp}
                >
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
                          opacity={layer.opacity ?? 1}
                          globalCompositeOperation={layer.blendMode ?? 'source-over'}
                          fontSize={previewText !== null && selectedLayerId === layer.uniqueId ? bulkFontSize : (layer.editableFontSize || getLayerFontData(layer).fontSize)}
                          fill={previewText !== null && selectedLayerId === layer.uniqueId ? bulkColor : (layer.editableFill || getLayerFontData(layer).fill)}
                          fontFamily={previewText !== null && selectedLayerId === layer.uniqueId ? bulkFontFamily : (layer.editableFontFamily || getLayerFontData(layer).fontFamily)}
                          fontStyle="bold"
                          draggable={activeTool === 'move' || activeTool === 'select'}
                          onMouseEnter={(e) => {
                            if (activeTool === 'move' || (activeTool === 'select' && selectedNodeId === layer.uniqueId)) {
                              e.target.getStage().container().style.cursor = 'move';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.getStage().container().style.cursor = activeTool === 'move' ? 'move' : 'default';
                          }}
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
                      
                      const isTextEdited = layer.text !== undefined && layer.editableText !== undefined;

                      return (
                        <Group 
                          key={layer.uniqueId}
                          id={layer.uniqueId}
                          x={layer.left || 0}
                          y={layer.top || 0}
                          opacity={layer.opacity ?? 1}
                          globalCompositeOperation={layer.blendMode ?? 'source-over'}
                          draggable={activeTool === 'move' || activeTool === 'select'}
                          onMouseEnter={(e) => {
                            if (activeTool === 'move' || (activeTool === 'select' && selectedNodeId === layer.uniqueId)) {
                              e.target.getStage().container().style.cursor = 'move';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.getStage().container().style.cursor = activeTool === 'move' ? 'move' : 'default';
                          }}
                          onClick={() => activeTool === 'select' && setSelectedNodeId(layer.uniqueId)}
                          onTap={() => activeTool === 'select' && setSelectedNodeId(layer.uniqueId)}
                          onDblClick={() => {
                            if (layer.text) {
                              const newLayers = [...layers];
                              const target = newLayers.find(l => l.uniqueId === layer.uniqueId);
                              if (target.editableText === undefined) {
                                target.editableText = target.text.text;
                                target.editableFontSize = 48;
                                target.editableFill = '#ffffff';
                                setLayers(newLayers);
                              }
                            }
                          }}
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
                          {isTextEdited ? (
                            <KonvaText 
                              text={layer.editableText}
                              fontSize={layer.editableFontSize || getLayerFontData(layer).fontSize}
                              fill={layer.editableFill || getLayerFontData(layer).fill}
                              fontFamily={layer.editableFontFamily || getLayerFontData(layer).fontFamily}
                              width={imgW}
                            />
                          ) : (
                            <FilteredImage layer={layer} imgW={imgW} imgH={imgH} />
                          )}
                          {layer.lines && layer.lines.map((line, i) => (
                            <KonvaLine
                              key={i}
                              points={line.points}
                              stroke={line.color}
                              strokeWidth={line.size}
                              tension={0.5}
                              lineCap="round"
                              lineJoin="round"
                              globalCompositeOperation={line.tool === 'eraser' ? 'destination-out' : 'source-over'}
                            />
                          ))}
                        </Group>
                      );
                    }
                    return null;
                  })}
                  {selectedNodeId && activeTool === 'select' && (
                    <Transformer 
                      ref={trRef}
                      anchorSize={12}
                      anchorCornerRadius={6}
                      borderStroke="#007acc"
                      anchorStroke="#007acc"
                      anchorFill="#ffffff"
                      borderDash={[4, 4]}
                      rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                      boundBoxFunc={(oldBox, newBox) => {
                        if (newBox.width < 5 || newBox.height < 5) {
                          return oldBox;
                        }
                        return newBox;
                      }}
                      anchorStyleFunc={(anchor) => {
                        if (anchor.hasName('rotater')) {
                          // Visual rendering of the rotater
                          anchor.sceneFunc((ctx, shape) => {
                            const cx = shape.width() / 2;
                            const cy = shape.height() / 2;
                            const r = 7;
                            
                            // Draw black circular arrow
                            ctx.beginPath();
                            ctx.strokeStyle = '#000000';
                            ctx.lineWidth = 2.5;
                            ctx.arc(cx, cy, r, Math.PI / 4, 0, false);
                            ctx.stroke();
                            
                            // Draw black arrow head
                            ctx.beginPath();
                            ctx.fillStyle = '#000000';
                            ctx.moveTo(cx + r, cy + 4);
                            ctx.lineTo(cx + r - 4, cy - 2);
                            ctx.lineTo(cx + r + 4, cy - 2);
                            ctx.fill();
                          });
                          
                          // Invisible expanded hit region so the whole icon area is clickable
                          anchor.hitFunc((ctx, shape) => {
                            ctx.beginPath();
                            ctx.rect(-10, -10, shape.width() + 20, shape.height() + 20);
                            ctx.fillStrokeShape(shape);
                          });
                        }
                      }}
                    />
                  )}
                  {hoveredLayerId && layers.some(l => l.uniqueId === hoveredLayerId && !l.hidden) && (() => {
                    const hlLayer = layers.find(l => l.uniqueId === hoveredLayerId);
                    if (!hlLayer) return null;
                    const w = hlLayer.imageElement ? hlLayer.imageElement.width : (hlLayer.right - hlLayer.left);
                    const h = hlLayer.imageElement ? hlLayer.imageElement.height : (hlLayer.bottom - hlLayer.top);
                    return (
                      <Group listening={false}>
                        {/* White contrast outline so it doesn't get lost on blue backgrounds */}
                        <Rect
                          x={hlLayer.left || 0}
                          y={hlLayer.top || 0}
                          width={w || 100}
                          height={h || 100}
                          stroke="#ffffff"
                          strokeWidth={4 / scale}
                        />
                        <Rect
                          x={hlLayer.left || 0}
                          y={hlLayer.top || 0}
                          width={w || 100}
                          height={h || 100}
                          stroke="#007acc"
                          strokeWidth={2 / scale}
                        />
                        {/* Corner Markers */}
                        <Rect x={(hlLayer.left || 0) - 3/scale} y={(hlLayer.top || 0) - 3/scale} width={6/scale} height={6/scale} fill="#007acc" stroke="#fff" strokeWidth={1/scale} />
                        <Rect x={(hlLayer.left || 0) + (w || 100) - 3/scale} y={(hlLayer.top || 0) - 3/scale} width={6/scale} height={6/scale} fill="#007acc" stroke="#fff" strokeWidth={1/scale} />
                        <Rect x={(hlLayer.left || 0) - 3/scale} y={(hlLayer.top || 0) + (h || 100) - 3/scale} width={6/scale} height={6/scale} fill="#007acc" stroke="#fff" strokeWidth={1/scale} />
                        <Rect x={(hlLayer.left || 0) + (w || 100) - 3/scale} y={(hlLayer.top || 0) + (h || 100) - 3/scale} width={6/scale} height={6/scale} fill="#007acc" stroke="#fff" strokeWidth={1/scale} />
                      </Group>
                    );
                  })()}
                </Layer>
              </Stage>
            </div>
          </div>
        )}
      </div>

        <div 
          className="panel-resizer"
          onMouseDown={() => setIsResizingRight(true)} 
          style={{ width: '12px', cursor: 'col-resize', backgroundColor: isResizingRight ? 'var(--accent)' : 'transparent', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-color)', transition: 'background-color 0.2s' }} 
        >
          <div style={{ width: '4px', height: '24px', backgroundColor: 'var(--border-color)', borderRadius: '2px' }} />
        </div>

        {/* Mobile Overlay */}
        <div className={`mobile-overlay ${showMobilePanel ? 'show' : ''}`} onClick={() => setShowMobilePanel(false)}></div>

        <div className={`right-panel ${showMobilePanel ? 'show' : ''}`} style={{ width: rightPanelWidth, backgroundColor: 'var(--bg-panel)', borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={18} color="var(--accent)" />
              Layers
            </h3>
          </div>
          <div className="layer-list">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={layers.map(l => l.uniqueId)} strategy={verticalListSortingStrategy}>
                {layers.map((layer, index) => (
                  <SortableLayerItem
                    key={layer.uniqueId}
                    layer={layer}
                    index={index}
                    selectedNodeId={selectedNodeId}
                    setSelectedNodeId={setSelectedNodeId}
                    setHoveredLayerId={setHoveredLayerId}
                    toggleLayerVisibility={toggleLayerVisibility}
                    duplicateLayer={duplicateLayer}
                    deleteLayer={deleteLayer}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <input type="file" accept=".psd, image/png, image/jpeg, image/jpg, image/webp" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
        </div>
      </div>

      {/* Bulk Generation Modal */}
      {showBulkModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <span>Bulk Banner Generation</span>
              <X size={20} style={{ cursor: 'pointer' }} onClick={closeBulkModal} />
            </div>
            
            <div className="modal-body">
              <label style={{ fontSize: '14px', color: 'var(--text-light)', fontWeight: '500' }}>1. Select the Text Layer to replace:</label>
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

              <label style={{ fontSize: '14px', color: 'var(--text-light)', fontWeight: '500', marginTop: '10px' }}>
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
                    <label style={{ fontSize: '12px', color: 'var(--text-light)', fontWeight: '500', display: 'block', marginBottom: '4px' }}>Font Size (px):</label>
                    <input type="number" value={bulkFontSize} onChange={e => setBulkFontSize(Number(e.target.value))} style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '4px' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-light)', fontWeight: '500', display: 'block', marginBottom: '4px' }}>Color:</label>
                    <input type="color" value={bulkColor} onChange={e => setBulkColor(e.target.value)} style={{ width: '100%', padding: '2px', height: '36px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-light)', fontWeight: '500', display: 'block', marginBottom: '4px' }}>Font:</label>
                    <select value={bulkFontFamily} onChange={e => setBulkFontFamily(e.target.value)} className="layer-select" style={{ padding: '8px', height: '36px' }}>
                      <option value="sans-serif">Sans Serif</option>
                      <option value="serif">Serif</option>
                      <option value="monospace">Monospace</option>
                      <option value="Arial">Arial</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Courier New">Courier</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Palatino">Palatino</option>
                      <option value="Garamond">Garamond</option>
                      <option value="Comic Sans MS">Comic Sans</option>
                      <option value="Trebuchet MS">Trebuchet MS</option>
                      <option value="Arial Black">Arial Black</option>
                      <option value="Impact">Impact</option>
                    </select>
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
