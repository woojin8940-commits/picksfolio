
import React, { useState, useEffect } from 'react';
import { Users, MessageCircle, X, Send, Heart } from 'lucide-react';
import SafeImage from './SafeImage';
import { trackClick } from '../services/analyticsService';

interface LiveStreamProps {
  username: string;
  currentProduct?: any;
  viewerCount: number;
  onClose: () => void;
}

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800';

const LiveStream: React.FC<LiveStreamProps> = ({ username, currentProduct, viewerCount, onClose }) => {
  const [messages, setMessages] = useState<{ id: string; user: string; text: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [likes, setLikes] = useState<number[]>([]);

  useEffect(() => {
    // In a real app, this would connect to a real stream
  }, []);

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    setMessages([...messages, { id: Date.now().toString(), user: '나', text: newMessage }]);
    setNewMessage('');
  };

  const addLike = () => {
    const id = Date.now();
    setLikes([...likes, id]);
    setTimeout(() => {
      setLikes(prev => prev.filter(l => l !== id));
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col md:flex-row overflow-hidden">
      {/* Main Stream Area */}
      <div className="flex-1 relative bg-slate-900 flex items-center justify-center overflow-hidden">
        {/* Placeholder for Video Stream */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 z-10 pointer-events-none" />
        <img 
          src={`https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80`} 
          className="w-full h-full object-cover opacity-60"
          alt="Live Stream"
        />
        
        {/* Top Overlay */}
        <div className="absolute top-0 left-0 right-0 p-6 z-20 flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-purple-500 overflow-hidden bg-slate-800">
              <SafeImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`} className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-white text-xs font-black tracking-tight">@{username}</p>
              <div className="flex items-center gap-2">
                <div className="bg-red-600 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest animate-pulse">
                  LIVE
                </div>
                <div className="flex items-center gap-1 text-white/60 text-[10px] font-bold">
                  <Users size={10} />
                  <span>{viewerCount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-all">
            <X size={24} />
          </button>
        </div>

        {/* Floating Likes */}
        <div className="absolute right-6 bottom-32 z-30 pointer-events-none">
          {likes.map(id => (
            <div key={id} className="absolute bottom-0 right-0 animate-bounce-up opacity-0">
              <Heart className="text-red-500 fill-red-500" size={32} />
            </div>
          ))}
        </div>

        {/* Current Product Overlay */}
        {currentProduct && (
          <div className="absolute left-6 bottom-6 right-6 md:right-auto md:w-80 z-30 animate-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-4 flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 border border-white/20">
                <SafeImage src={currentProduct.image || FALLBACK_IMAGE} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-white text-sm font-black truncate">{currentProduct.name}</h4>
              </div>
              <a 
                href={currentProduct.link.startsWith('http') ? currentProduct.link : `https://${currentProduct.link}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackClick(username, currentProduct.id || 'live-product')}
                className="bg-purple-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all flex items-center justify-center"
              >
                구매하기
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="w-full md:w-96 bg-slate-950 flex flex-col border-l border-white/5">
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="text-purple-500" size={20} />
            <h3 className="text-white font-black text-sm uppercase tracking-widest">실시간 채팅</h3>
          </div>
          <button onClick={addLike} className="p-2 bg-white/5 rounded-full text-red-500 hover:bg-white/10 transition-all">
            <Heart size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
          {messages.map((msg) => (
            <div key={msg.id} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
              <span className="text-purple-400 text-[10px] font-black uppercase tracking-widest mr-2">{msg.user}</span>
              <p className="text-white/80 text-sm font-medium leading-relaxed">{msg.text}</p>
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-white/5">
          <div className="relative">
            <input 
              type="text" 
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="메시지를 입력하세요..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 pr-14 text-white text-sm focus:outline-none focus:border-purple-500/50 transition-all"
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

      <style>{`
        @keyframes bounce-up {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-150px) scale(1.5); opacity: 0; }
        }
        .animate-bounce-up {
          animation: bounce-up 2s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default LiveStream;
