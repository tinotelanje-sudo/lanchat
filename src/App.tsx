import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, User, MessageSquare, Clock, Users, ChevronRight, Sparkles, Loader2, Smile, QrCode, X, Smartphone, Video, Phone, PhoneOff, Mic, MicOff, Camera, CameraOff, Paperclip, File, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { QRCodeSVG } from 'qrcode.react';

interface Message {
  username: string;
  text: string;
  timestamp: string;
  id: string;
  isAI?: boolean;
  reactions: Record<string, string[]>; // emoji -> list of usernames
  file?: { name: string; type: string; data: string };
}

interface NetworkInfo {
  ips: string[];
  port: number;
}

interface ConnectedUser {
  id: string;
  username: string;
}

const socket: Socket = io();

const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];

// Initialize Gemini AI
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [inputText, setInputText] = useState('');
  const [username, setUsername] = useState('');
  const [isUsernameSet, setIsUsernameSet] = useState(false);
  const [showUserList, setShowUserList] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // WebRTC State
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'receiving' | 'connected'>('idle');
  const [caller, setCaller] = useState<{ id: string, name: string, signal: RTCSessionDescriptionInit, callType: 'video' | 'voice' } | null>(null);
  const [activeCallPeer, setActiveCallPeer] = useState<string | null>(null);
  const [callType, setCallType] = useState<'video' | 'voice'>('video');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef(username);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  // Initialize ringtone
  useEffect(() => {
    ringtoneRef.current = new Audio('https://actions.google.com/sounds/v1/alarms/phone_ringing.ogg');
    ringtoneRef.current.loop = true;
    
    return () => {
      ringtoneRef.current?.pause();
    };
  }, []);

  // Handle ringtone play/pause based on call state
  useEffect(() => {
    if (callState === 'calling' || callState === 'receiving') {
      ringtoneRef.current?.play().catch(e => console.error("Ringtone play failed:", e));
    } else {
      ringtoneRef.current?.pause();
      if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    }
  }, [callState]);

  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.error("Audio play failed", e);
    }
  };

  useEffect(() => {
    // Fetch network info for LAN connection
    fetch('/api/network-info')
      .then(res => res.json())
      .then(data => setNetworkInfo(data))
      .catch(err => console.error("Failed to fetch network info:", err));

    socket.on('receive_message', (data: Message) => {
      setMessages((prev) => [...prev, { ...data, reactions: data.reactions || {} }]);
      
      if (data.username !== usernameRef.current) {
        playNotificationSound();
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
          new Notification(`Mesej dari ${data.username}`, {
            body: data.text || (data.file ? `Fail: ${data.file.name}` : 'Mesej baru'),
          });
        }
      }
    });

    socket.on('update_user_list', (users: ConnectedUser[]) => {
      setConnectedUsers(users);
    });

    socket.on('update_reaction', ({ messageId, emoji, username: reactorName }) => {
      setMessages((prev) => prev.map(msg => {
        if (msg.id === messageId) {
          const currentReactions = { ...msg.reactions };
          const usersForEmoji = currentReactions[emoji] || [];
          
          if (usersForEmoji.includes(reactorName)) {
            // Remove reaction if already exists
            currentReactions[emoji] = usersForEmoji.filter(u => u !== reactorName);
            if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
          } else {
            // Add reaction
            currentReactions[emoji] = [...usersForEmoji, reactorName];
          }
          
          return { ...msg, reactions: currentReactions };
        }
        return msg;
      }));
    });

    socket.on('user_typing', (user: string) => {
      setTypingUsers((prev) => {
        if (!prev.includes(user)) return [...prev, user];
        return prev;
      });
    });

    socket.on('user_stop_typing', (user: string) => {
      setTypingUsers((prev) => prev.filter((u) => u !== user));
    });

    // WebRTC Signaling Listeners
    socket.on('incoming_call', ({ signal, from, name, callType }) => {
      setCaller({ id: from, name, signal, callType });
      setCallType(callType);
      setCallState('receiving');
      playNotificationSound();
    });

    socket.on('call_accepted', async (signal) => {
      setCallState('connected');
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(signal));
      }
    });

    socket.on('ice_candidate', async (candidate) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      }
    });

    socket.on('call_ended', () => {
      cleanupCall();
    });

    return () => {
      socket.off('receive_message');
      socket.off('update_user_list');
      socket.off('update_reaction');
      socket.off('user_typing');
      socket.off('user_stop_typing');
      socket.off('incoming_call');
      socket.off('call_accepted');
      socket.off('ice_candidate');
      socket.off('call_ended');
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, callState]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callState]);

  const askAI = async (prompt: string) => {
    setIsAiLoading(true);
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          systemInstruction: "Anda adalah pembantu AI pintar dalam aplikasi LAN Messenger. Berikan jawapan yang ringkas, tepat, dan membantu dalam Bahasa Melayu. Jika ditanya tentang model, anda adalah Gemini 3.1 Pro.",
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        },
      });

      const aiText = response.text || "Maaf, saya tidak dapat memproses permintaan itu.";
      
      const aiMessage = {
        username: "Gemini AI",
        text: aiText,
        id: Math.random().toString(36).substr(2, 9),
        isAI: true,
        reactions: {},
      };
      
      socket.emit('send_message', aiMessage);
    } catch (error) {
      console.error("AI Error:", error);
      const errorMessage = {
        username: "System",
        text: "Ralat semasa menghubungi AI. Sila cuba lagi.",
        id: Math.random().toString(36).substr(2, 9),
        reactions: {},
      };
      socket.emit('send_message', errorMessage);
    } finally {
      setIsAiLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const clearFileSelection = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUsernameSet) return;
    if (!inputText.trim() && !selectedFile) return;

    const text = inputText.trim();
    const messageId = Math.random().toString(36).substr(2, 9);

    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = ev.target?.result as string;
        const messageData = {
          username,
          text,
          id: messageId,
          reactions: {},
          file: { name: selectedFile.name, type: selectedFile.type, data }
        };
        socket.emit('send_message', messageData);
        setInputText('');
        clearFileSelection();
        
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        socket.emit('stop_typing', username);

        if (text.toLowerCase().startsWith('/ai ')) {
          const prompt = text.slice(4);
          askAI(prompt);
        }
      };
      reader.readAsDataURL(selectedFile);
    } else {
      const messageData = {
        username,
        text,
        id: messageId,
        reactions: {},
      };
      
      socket.emit('send_message', messageData);
      setInputText('');
      
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      socket.emit('stop_typing', username);

      if (text.toLowerCase().startsWith('/ai ')) {
        const prompt = text.slice(4);
        askAI(prompt);
      }
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (!isUsernameSet) return;

    if (e.target.value.trim() === '') {
      socket.emit('stop_typing', username);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      return;
    }

    socket.emit('typing', username);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', username);
    }, 2000);
  };

  const handleSetUsername = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setIsUsernameSet(true);
      socket.emit('user_join', username);
      if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 50 * 1024 * 1024) {
      alert("Saiz fail terlalu besar (Maksimum 50MB)");
      return;
    }

    setSelectedFile(file);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setFilePreview(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  };

  const handleAddReaction = (messageId: string, emoji: string) => {
    socket.emit('add_reaction', { messageId, emoji, username });
    setActiveEmojiPicker(null);
  };

  // WebRTC Functions
  const setupMedia = async (type: 'video' | 'voice') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error("Failed to get local stream", err);
      alert("Sila benarkan akses kamera/mikrofon untuk panggilan.");
      return null;
    }
  };

  const createPeerConnection = (targetId: string, stream: MediaStream) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    });
    peerConnectionRef.current = pc;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice_candidate', { to: targetId, candidate: event.candidate });
      }
    };

    return pc;
  };

  const startCall = async (targetId: string, targetName: string, type: 'video' | 'voice') => {
    setCallType(type);
    const stream = await setupMedia(type);
    if (!stream) return;

    const pc = createPeerConnection(targetId, stream);
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('call_user', { userToCall: targetId, signalData: offer, from: socket.id, name: username, callType: type });
    setActiveCallPeer(targetId);
    setCallState('calling');
  };

  const acceptCall = async () => {
    if (!caller) return;
    
    const stream = await setupMedia(caller.callType);
    if (!stream) return;

    const pc = createPeerConnection(caller.id, stream);
    
    await pc.setRemoteDescription(new RTCSessionDescription(caller.signal));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer_call', { to: caller.id, signal: answer });
    setActiveCallPeer(caller.id);
    setCallState('connected');
  };

  const cleanupCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    setLocalStream(null);
    setRemoteStream(null);
    setCallState('idle');
    setCaller(null);
    setActiveCallPeer(null);
    peerConnectionRef.current = null;
    setIsMuted(false);
    setIsVideoOff(false);
  };

  const endCall = () => {
    if (activeCallPeer) {
      socket.emit('end_call', { to: activeCallPeer });
    } else if (caller) {
      socket.emit('end_call', { to: caller.id });
    }
    cleanupCall();
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

  if (!isUsernameSet) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-4 border border-emerald-500/20">
              <MessageSquare className="text-emerald-500 w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">LAN Messenger</h1>
            <p className="text-zinc-500 text-sm mt-1">Sertai perbualan rangkaian tempatan</p>
          </div>

          <form onSubmit={handleSetUsername} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Nama Pengguna</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 w-4 h-4" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan nama anda..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
                  autoFocus
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 active:scale-[0.98]"
            >
              Mula Bersembang
            </button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-zinc-800 text-center">
            <button 
              onClick={() => setShowConnectModal(true)}
              className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-emerald-400 transition-colors"
            >
              <QrCode className="w-4 h-4" />
              Sambung peranti lain (QR / IP)
            </button>
          </div>
        </motion.div>

        {/* Connect Modal for Login Screen */}
        <AnimatePresence>
          {showConnectModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl relative"
              >
                <button 
                  onClick={() => setShowConnectModal(false)}
                  className="absolute top-4 right-4 p-1 text-zinc-500 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
                
                <div className="text-center mb-6">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mx-auto mb-3 border border-emerald-500/20">
                    <Smartphone className="text-emerald-500 w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Sambung Peranti</h3>
                  <p className="text-xs text-zinc-400 mt-1">Imbas kod QR atau layari alamat IP di bawah pada peranti lain dalam rangkaian yang sama.</p>
                </div>

                <div className="bg-white p-4 rounded-xl flex justify-center mb-6">
                  <QRCodeSVG value={currentUrl} size={200} level="H" includeMargin={false} />
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Alamat IP Tempatan (LAN)</div>
                  {networkInfo?.ips && networkInfo.ips.length > 0 ? (
                    networkInfo.ips.map((ip, idx) => (
                      <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between">
                        <code className="text-emerald-400 text-sm font-mono">http://{ip}:{networkInfo.port}</code>
                      </div>
                    ))
                  ) : (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-center">
                      <code className="text-zinc-400 text-sm font-mono">{currentUrl}</code>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-zinc-900 bg-zinc-950/50 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center border border-emerald-500/20">
            <MessageSquare className="text-emerald-500 w-4 h-4" />
          </div>
          <h2 className="font-semibold text-white tracking-tight hidden sm:block">LAN Messenger</h2>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          <button 
            onClick={() => setShowConnectModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-zinc-800 hover:bg-zinc-800 transition-colors"
            title="Sambung Peranti Lain"
          >
            <QrCode className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-zinc-400 hidden sm:inline">Sambung</span>
          </button>
          <button 
            onClick={() => setShowUserList(!showUserList)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-zinc-800 hover:bg-zinc-800 transition-colors"
          >
            <Users className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-zinc-400">{connectedUsers.length} Online</span>
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-zinc-800 hidden sm:flex">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-zinc-400">{username}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* User List Sidebar */}
        <AnimatePresence>
          {showUserList && (
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute right-0 top-0 bottom-0 w-64 bg-zinc-900 border-l border-zinc-800 z-30 shadow-2xl"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-500" />
                    Pengguna Aktif
                  </h3>
                  <button 
                    onClick={() => setShowUserList(false)}
                    className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-2 rounded-xl bg-violet-500/5 border border-violet-500/20">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
                      <Sparkles className="w-4 h-4 text-violet-500" />
                    </div>
                    <span className="text-sm font-medium text-violet-400">Gemini AI (Bot)</span>
                  </div>
                  {connectedUsers.map((user, idx) => (
                    <motion.div 
                      key={`${user.id}-${idx}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-zinc-800/50 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center border border-zinc-700 group-hover:border-emerald-500/30 transition-colors">
                          <User className="w-4 h-4 text-zinc-500 group-hover:text-emerald-500" />
                        </div>
                        <span className={`text-sm font-medium ${user.id === socket.id ? 'text-emerald-500' : 'text-zinc-400'}`}>
                          {user.username} {user.id === socket.id && '(Anda)'}
                        </span>
                      </div>
                      {user.id !== socket.id && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => startCall(user.id, user.username, 'voice')}
                            className="p-2 bg-zinc-800/50 hover:bg-emerald-500/20 text-zinc-500 hover:text-emerald-500 rounded-lg transition-colors"
                            title="Panggilan Suara"
                          >
                            <Phone className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => startCall(user.id, user.username, 'video')}
                            className="p-2 bg-zinc-800/50 hover:bg-emerald-500/20 text-zinc-500 hover:text-emerald-500 rounded-lg transition-colors"
                            title="Panggilan Video"
                          >
                            <Video className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8 max-w-4xl mx-auto w-full scrollbar-hide">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex flex-col group relative ${msg.username === username ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 mb-1 px-1">
                  {msg.isAI && <Sparkles className="w-3 h-3 text-violet-400" />}
                  <span className={`text-xs font-semibold ${msg.isAI ? 'text-violet-400' : 'text-zinc-500'}`}>
                    {msg.username}
                    {msg.isAI && <span className="ml-1.5 px-1 py-0.5 bg-violet-500/20 border border-violet-500/30 rounded text-[8px] uppercase tracking-tighter">Bot</span>}
                  </span>
                  <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {msg.timestamp}
                  </span>
                </div>
                
                <div className="relative flex items-center gap-2 max-w-full">
                  {/* Reaction Button (Desktop Hover) */}
                  <button 
                    onClick={() => setActiveEmojiPicker(activeEmojiPicker === msg.id ? null : msg.id)}
                    className={`p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800 ${msg.username === username ? 'order-first' : 'order-last'}`}
                  >
                    <Smile className="w-4 h-4 text-zinc-500" />
                  </button>

                  <div 
                    className={`max-w-[85%] md:max-w-[70%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm transition-all ${
                      msg.username === username 
                        ? 'bg-emerald-600 text-white rounded-tr-none' 
                        : msg.isAI 
                          ? 'bg-gradient-to-br from-violet-600/20 to-fuchsia-600/10 text-violet-100 border border-violet-500/40 rounded-tl-none shadow-lg shadow-violet-900/10'
                          : 'bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-tl-none'
                    }`}
                  >
                    {msg.text && <p>{msg.text}</p>}
                    {msg.file && (
                      <div className={`mt-2 ${msg.text ? 'pt-2 border-t border-white/10' : ''}`}>
                        {msg.file.type.startsWith('image/') ? (
                          <img src={msg.file.data} alt={msg.file.name} className="max-w-full h-auto rounded-lg max-h-64 object-contain" />
                        ) : (
                          <a href={msg.file.data} download={msg.file.name} className="flex items-center gap-2 bg-black/20 p-3 rounded-lg hover:bg-black/30 transition-colors text-white">
                            <File className="w-5 h-5 shrink-0" />
                            <span className="text-sm truncate max-w-[200px]">{msg.file.name}</span>
                            <Download className="w-4 h-4 shrink-0 ml-2" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Emoji Picker Overlay */}
                  <AnimatePresence>
                    {activeEmojiPicker === msg.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 10 }}
                        className={`absolute bottom-full mb-2 bg-zinc-900 border border-zinc-800 rounded-xl p-2 shadow-2xl z-40 flex gap-1 ${msg.username === username ? 'right-0' : 'left-0'}`}
                      >
                        {COMMON_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => handleAddReaction(msg.id, emoji)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-zinc-800 rounded-lg transition-colors text-lg"
                          >
                            {emoji}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Display Reactions */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1.5 ${msg.username === username ? 'justify-end' : 'justify-start'}`}>
                    {Object.entries(msg.reactions).map(([emoji, users]) => (
                      <button
                        key={emoji}
                        onClick={() => handleAddReaction(msg.id, emoji)}
                        title={users.join(', ')}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border transition-all ${
                          users.includes(username)
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <span>{emoji}</span>
                        <span className="font-bold">{users.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
            {isAiLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-start"
              >
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-xs font-semibold text-violet-400">Gemini AI</span>
                  <span className="text-[10px] text-zinc-600">Sedang berfikir...</span>
                </div>
                <div className="bg-violet-600/10 border border-violet-500/20 rounded-2xl rounded-tl-none px-4 py-3">
                  <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
                </div>
              </motion.div>
            )}
            
            {/* Typing Indicator */}
            {typingUsers.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-3 px-2 py-1"
              >
                <div className="flex gap-1 bg-zinc-900 px-3 py-2 rounded-full border border-zinc-800">
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-zinc-500 italic">
                  {typingUsers.length === 1 
                    ? `${typingUsers[0]} sedang menaip...`
                    : typingUsers.length === 2
                      ? `${typingUsers[0]} dan ${typingUsers[1]} sedang menaip...`
                      : `${typingUsers.length} orang sedang menaip...`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </main>
      </div>

      {/* Input Area */}
      <footer className="p-4 md:p-6 border-t border-zinc-900 bg-zinc-950/50 backdrop-blur-md shrink-0">
        <div className="max-w-4xl mx-auto mb-2">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Tip: Taip <span className="text-violet-500">/ai [soalan]</span> untuk bertanya kepada Gemini 3.1</p>
        </div>
        
        {selectedFile && (
          <div className="max-w-4xl mx-auto mb-3 p-3 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3 overflow-hidden">
              {filePreview ? (
                <img src={filePreview} alt="Preview" className="w-12 h-12 object-cover rounded-lg" />
              ) : (
                <div className="w-12 h-12 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0">
                  <File className="w-6 h-6 text-zinc-400" />
                </div>
              )}
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium text-zinc-200 truncate">{selectedFile.name}</span>
                <span className="text-xs text-zinc-500">{formatFileSize(selectedFile.size)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={clearFileSelection}
              className="p-2 text-zinc-500 hover:text-red-400 transition-colors shrink-0"
              title="Batal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <form 
          onSubmit={handleSendMessage}
          className="max-w-4xl mx-auto flex gap-3 items-center"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-emerald-500 hover:border-emerald-500/50 transition-colors"
            title="Muat Naik Fail"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={inputText}
            onChange={handleTyping}
            placeholder="Tulis mesej atau /ai untuk bantuan..."
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={(!inputText.trim() && !selectedFile) || isAiLoading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-emerald-900/20 active:scale-95 shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </footer>

      {/* Connect Modal for Main Screen */}
      <AnimatePresence>
        {showConnectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl relative"
            >
              <button 
                onClick={() => setShowConnectModal(false)}
                className="absolute top-4 right-4 p-1 text-zinc-500 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mx-auto mb-3 border border-emerald-500/20">
                  <Smartphone className="text-emerald-500 w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white">Sambung Peranti</h3>
                <p className="text-xs text-zinc-400 mt-1">Imbas kod QR atau layari alamat IP di bawah pada peranti lain dalam rangkaian yang sama.</p>
              </div>

              <div className="bg-white p-4 rounded-xl flex justify-center mb-6">
                <QRCodeSVG value={currentUrl} size={200} level="H" includeMargin={false} />
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Alamat IP Tempatan (LAN)</div>
                {networkInfo?.ips && networkInfo.ips.length > 0 ? (
                  networkInfo.ips.map((ip, idx) => (
                    <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between">
                      <code className="text-emerald-400 text-sm font-mono">http://{ip}:{networkInfo.port}</code>
                    </div>
                  ))
                ) : (
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-center">
                    <code className="text-zinc-400 text-sm font-mono">{currentUrl}</code>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {/* Incoming Call Modal */}
        {callState === 'receiving' && caller && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border-4 border-emerald-500/30 animate-pulse">
                {caller.callType === 'video' ? <Video className="w-10 h-10 text-emerald-500" /> : <Phone className="w-10 h-10 text-emerald-500" />}
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">{caller.name}</h3>
              <p className="text-zinc-400 mb-8">Panggilan {caller.callType === 'video' ? 'Video' : 'Suara'} Masuk...</p>
              
              <div className="flex justify-center gap-4">
                <button
                  onClick={endCall}
                  className="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg shadow-red-500/20"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>
                <button
                  onClick={acceptCall}
                  className="w-14 h-14 bg-emerald-500 hover:bg-emerald-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg shadow-emerald-500/20"
                >
                  <Phone className="w-6 h-6" />
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Active Call Modal */}
        {(callState === 'calling' || callState === 'connected') && (
          <div className="fixed inset-0 z-[60] bg-black flex flex-col">
            <div className="flex-1 relative">
              {/* Remote Video or Voice Avatar */}
              {callType === 'video' ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover bg-zinc-900"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900">
                  <div className="w-32 h-32 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border-4 border-emerald-500/30 animate-pulse">
                    <Phone className="w-16 h-16 text-emerald-500" />
                  </div>
                  <h3 className="text-3xl font-bold text-white mb-2">
                    {activeCallPeer ? connectedUsers.find(u => u.id === activeCallPeer)?.username : caller?.name}
                  </h3>
                  <p className="text-zinc-400">{callState === 'calling' ? 'Memanggil...' : 'Panggilan Suara Aktif'}</p>
                </div>
              )}
              
              {/* Call Status Overlay */}
              {callState === 'calling' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border-4 border-emerald-500/30 animate-pulse">
                    {callType === 'video' ? <Video className="w-10 h-10 text-emerald-500" /> : <Phone className="w-10 h-10 text-emerald-500" />}
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">Memanggil...</h3>
                  <p className="text-zinc-400">Menunggu jawapan</p>
                </div>
              )}

              {/* Local Video (Picture-in-Picture) */}
              {callType === 'video' && (
                <div className="absolute top-6 right-6 w-32 md:w-48 aspect-[3/4] md:aspect-video bg-zinc-800 rounded-2xl overflow-hidden border-2 border-zinc-700 shadow-2xl z-10">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
                  />
                  {isVideoOff && (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
                      <User className="w-8 h-8 text-zinc-600" />
                    </div>
                  )}
                </div>
              )}

              {/* Call Controls */}
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 px-6 py-4 bg-zinc-900/80 backdrop-blur-md rounded-full border border-zinc-800">
                <button
                  onClick={toggleMute}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/20 text-red-500' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}
                >
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                
                <button
                  onClick={endCall}
                  className="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg shadow-red-500/20 mx-2"
                >
                  <PhoneOff className="w-6 h-6" />
                </button>

                {callType === 'video' && (
                  <button
                    onClick={toggleVideo}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-500/20 text-red-500' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}
                  >
                    {isVideoOff ? <CameraOff className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
