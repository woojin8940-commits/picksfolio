
import React, { useState, useEffect, useRef } from 'react';
import { Users, MessageCircle, X, Send, Camera, Mic, MicOff, CameraOff, Monitor, Settings, Image as ImageIcon, Split, Layout } from 'lucide-react';
import { supabase } from '../services/supabase';

interface LiveStreamingProps {
  userName: string;
  onClose: () => void;
}

const LiveStreaming: React.FC<LiveStreamingProps> = ({ userName, onClose }) => {
  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [activeMaterial, setActiveMaterial] = useState<'none' | 'banner' | 'product' | 'beforeAfter'>('none');
  const [showMaterialSettings, setShowMaterialSettings] = useState(false);
  const [materialUrls, setMaterialUrls] = useState({
    banner: 'https://picsum.photos/seed/banner/800/200',
    product: 'https://picsum.photos/seed/product/400/600',
    before: 'https://picsum.photos/seed/before/400/600',
    after: 'https://picsum.photos/seed/after/400/600'
  });

  const [messages, setMessages] = useState<{ id: string; user: string; text: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;

    if (isCameraOn) {
      const constraints = {
        video: {
          width: { ideal: 1280, min: 1280 },
          height: { ideal: 720, min: 720 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: isMicOn ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false
      };

      navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
          if (!mounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }

          // [WebRTC Optimization Reference] 
          // Note: If using RTCPeerConnection, apply bitrate and degradation preference.
          // This ensures high quality even in unstable network conditions.
          /*
          const applyWebRTCOptimizations = (pc: RTCPeerConnection) => {
            const senders = pc.getSenders();
            const videoSender = senders.find(s => s.track?.kind === 'video');
            if (videoSender) {
              const parameters = videoSender.getParameters();
              if (!parameters.encodings) parameters.encodings = [{}];
              
              // Set bitrate to 5,000kbps (5Mbps)
              parameters.encodings[0].maxBitrate = 5000000;
              
              // Maintain resolution even if network is unstable
              parameters.degradationPreference = 'maintain-resolution';
              
              videoSender.setParameters(parameters).catch(err => 
                console.error("Error applying WebRTC optimizations:", err)
              );
            }
          };
          */
        })
        .catch(err => console.error("Error accessing camera:", err));
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isCameraOn, isMicOn]);

  const toggleLive = async () => {
    const newState = !isLive;
    setIsLive(newState);
    const normalizedUsername = userName.toLowerCase();
    
    if (newState) {
      const vCount = 0;
      setViewerCount(vCount);
      
      // Update LocalStorage for immediate local sync
      localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify({
        isLive: true,
        viewerCount: vCount,
        currentProduct: null
      }));

      // Update Supabase
      if (supabase) {
        await supabase
          .from('live_sessions')
          .upsert({ 
            username: userName, 
            is_live: true, 
            viewer_count: vCount
          });
      }
    } else {
      setViewerCount(0);
      setIsCameraOn(false);
      setIsMicOn(false);
      
      // Update LocalStorage
      localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify({
        isLive: false,
        viewerCount: 0,
        currentProduct: null
      }));

      if (supabase) {
        await supabase
          .from('live_sessions')
          .update({ is_live: false, viewer_count: 0 })
          .eq('username', userName);
      }
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    setMessages([...messages, { id: Date.now().toString(), user: '나(스트리머)', text: newMessage }]);
    setNewMessage('');
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950 flex">
      {/* Main Stream Area */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <video 
          ref={videoRef} 
          autoPlay 
          muted 
          playsInline 
          className="w-full h-full object-cover"
        />
        
        {!isCameraOn && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
            <div className="text-center space-y-4">
              <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto">
                <CameraOff size={40} className="text-slate-600" />
              </div>
              <p className="text-slate-500 font-black uppercase tracking-widest text-xs">Camera is Off</p>
            </div>
          </div>
        )}

        {/* Material Overlays */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-12">
          {activeMaterial === 'banner' && (
            <div className="w-full max-w-2xl bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl overflow-hidden animate-in slide-in-from-top duration-500 mt-20">
              <img src={materialUrls.banner} alt="Banner" className="w-full h-32 object-cover" />
              <div className="p-4 bg-black/60">
                <p className="text-white font-black text-center uppercase tracking-widest">SEASON OFF SALE - UP TO 70%</p>
              </div>
            </div>
          )}

          {activeMaterial === 'product' && (
            <div className="absolute right-12 bottom-32 w-48 aspect-[3/4] bg-white rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in duration-500 border-4 border-white">
              <img src={materialUrls.product} alt="Product" className="w-full h-full object-cover" />
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/60 backdrop-blur-md">
                <p className="text-white text-[10px] font-black text-center">오버핏 울 자켓</p>
              </div>
            </div>
          )}

          {activeMaterial === 'beforeAfter' && (
            <div className="flex gap-4 w-full max-w-3xl animate-in fade-in duration-500">
              <div className="flex-1 aspect-[3/4] bg-white rounded-3xl overflow-hidden shadow-2xl border-4 border-white relative">
                <img src={materialUrls.before} alt="Before" className="w-full h-full object-cover" />
                <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded-full text-[10px] font-black text-white uppercase">BEFORE</div>
              </div>
              <div className="flex-1 aspect-[3/4] bg-white rounded-3xl overflow-hidden shadow-2xl border-4 border-white relative">
                <img src={materialUrls.after} alt="After" className="w-full h-full object-cover" />
                <div className="absolute top-4 left-4 bg-purple-600 px-3 py-1 rounded-full text-[10px] font-black text-white uppercase">AFTER</div>
              </div>
            </div>
          )}
        </div>

        {/* Overlay UI */}
        <div className="absolute inset-0 p-8 flex flex-col justify-between pointer-events-none">
          <div className="flex justify-between items-start pointer-events-auto">
            <div className="flex items-center gap-4">
              <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
                <span className="text-white text-xs font-black uppercase tracking-widest">
                  {isLive ? 'LIVE' : 'PREVIEW'}
                </span>
                {isLive && (
                  <div className="h-4 w-[1px] bg-white/20 mx-1" />
                )}
                {isLive && (
                  <span className="text-white/60 text-[10px] font-bold flex items-center gap-1">
                    <Users size={12} /> {viewerCount}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowMaterialSettings(!showMaterialSettings)}
                className={`p-3 backdrop-blur-md rounded-full text-white transition-all ${showMaterialSettings ? 'bg-purple-600' : 'bg-black/40 hover:bg-black/60'}`}
              >
                <Settings size={24} />
              </button>
              <button onClick={onClose} className="p-3 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-all">
                <X size={24} />
              </button>
            </div>
          </div>

          {/* Bottom Menu Bar */}
          <div className="flex flex-col gap-6 pointer-events-auto">
            {showMaterialSettings && (
              <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-6 rounded-[2rem] w-full max-w-md animate-in slide-in-from-bottom-4 duration-300">
                <h4 className="text-white font-black text-sm mb-4 uppercase tracking-widest">방송 자료 설정</h4>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">배너 이미지 URL</label>
                    <input 
                      type="text" 
                      value={materialUrls.banner}
                      onChange={(e) => setMaterialUrls({...materialUrls, banner: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">상품샷 이미지 URL</label>
                    <input 
                      type="text" 
                      value={materialUrls.product}
                      onChange={(e) => setMaterialUrls({...materialUrls, product: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-white text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between items-end">
              <div className="flex flex-col gap-4">
                {/* Broadcast Menu Bar */}
                <div className="bg-black/40 backdrop-blur-md p-2 rounded-2xl border border-white/10 flex gap-2">
                  <button 
                    onClick={() => setActiveMaterial(activeMaterial === 'banner' ? 'none' : 'banner')}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${activeMaterial === 'banner' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'}`}
                  >
                    <Layout size={14} /> 배너
                  </button>
                  <button 
                    onClick={() => setActiveMaterial(activeMaterial === 'product' ? 'none' : 'product')}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${activeMaterial === 'product' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'}`}
                  >
                    <ImageIcon size={14} /> 상품샷
                  </button>
                  <button 
                    onClick={() => setActiveMaterial(activeMaterial === 'beforeAfter' ? 'none' : 'beforeAfter')}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${activeMaterial === 'beforeAfter' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'}`}
                  >
                    <Split size={14} /> 비포애프터
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsCameraOn(!isCameraOn)}
                    className={`p-4 rounded-full backdrop-blur-md transition-all ${isCameraOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}
                  >
                    {isCameraOn ? <Camera size={24} /> : <CameraOff size={24} />}
                  </button>
                  <button 
                    onClick={() => setIsMicOn(!isMicOn)}
                    className={`p-4 rounded-full backdrop-blur-md transition-all ${isMicOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}
                  >
                    {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                  </button>
                  <button className="p-4 bg-white/10 backdrop-blur-md text-white rounded-full hover:bg-white/20 transition-all">
                    <Monitor size={24} />
                  </button>
                </div>
              </div>

              <button 
                onClick={toggleLive}
                className={`px-10 py-5 rounded-full text-lg font-black transition-all shadow-2xl active:scale-95 ${isLive ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
              >
                {isLive ? '방송 종료' : '라이브 시작'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar (Chat & Controls) */}
      <div className="w-[400px] bg-slate-900 border-l border-white/5 flex flex-col">
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-white font-black flex items-center gap-2">
            <MessageCircle size={20} className="text-purple-500" /> 실시간 채팅
          </h3>
          <button className="text-slate-500 hover:text-white transition-colors">
            <Settings size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
          {messages.map(msg => (
            <div key={msg.id} className="animate-in slide-in-from-bottom-2">
              <span className="text-purple-400 text-[10px] font-black uppercase tracking-widest block mb-1">{msg.user}</span>
              <div className="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none text-white text-sm leading-relaxed">
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 bg-slate-950/50">
          <div className="relative">
            <input 
              type="text" 
              placeholder="메시지를 입력하세요..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white text-sm outline-none focus:border-purple-500/50 transition-all"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <button 
              onClick={handleSendMessage}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-purple-500 hover:text-purple-400"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveStreaming;
