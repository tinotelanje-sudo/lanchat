import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, User, MessageSquare, Clock, Users, ChevronRight, Sparkles, Loader2, Smile } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

interface Message {
  username: string;
  text: string;
  timestamp: string;
  id: string;
  isAI?: boolean;
  reactions: Record<string, string[]>; // emoji -> list of usernames
}

const socket: Socket = io();

const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];

// Initialize Gemini AI
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [username, setUsername] = useState('');
  const [isUsernameSet, setIsUsernameSet] = useState(false);
  const [showUserList, setShowUserList] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socket.on('receive_message', (data: Message) => {
      setMessages((prev) => [...prev, { ...data, reactions: data.reactions || {} }]);
    });

    socket.on('update_user_list', (users: string[]) => {
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

    return () => {
      socket.off('receive_message');
      socket.off('update_user_list');
      socket.off('update_reaction');
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim() && isUsernameSet) {
      const text = inputText.trim();
      const messageData = {
        username,
        text,
        id: Math.random().toString(36).substr(2, 9),
        reactions: {},
      };
      
      socket.emit('send_message', messageData);
      setInputText('');

      // Check for AI trigger
      if (text.toLowerCase().startsWith('/ai ')) {
        const prompt = text.slice(4);
        await askAI(prompt);
      }
    }
  };

  const handleSetUsername = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setIsUsernameSet(true);
      socket.emit('user_join', username);
    }
  };

  const handleAddReaction = (messageId: string, emoji: string) => {
    socket.emit('add_reaction', { messageId, emoji, username });
    setActiveEmojiPicker(null);
  };

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
        </motion.div>
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
          <h2 className="font-semibold text-white tracking-tight">LAN Messenger</h2>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowUserList(!showUserList)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-zinc-800 hover:bg-zinc-800 transition-colors"
          >
            <Users className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-zinc-400">{connectedUsers.length} Online</span>
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-zinc-800">
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
                      key={`${user}-${idx}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex items-center gap-3 p-2 rounded-xl hover:bg-zinc-800/50 transition-colors group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center border border-zinc-700 group-hover:border-emerald-500/30 transition-colors">
                        <User className="w-4 h-4 text-zinc-500 group-hover:text-emerald-500" />
                      </div>
                      <span className={`text-sm font-medium ${user === username ? 'text-emerald-500' : 'text-zinc-400'}`}>
                        {user} {user === username && '(Anda)'}
                      </span>
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
                    {msg.text}
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
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </main>
      </div>

      {/* Input Area */}
      <footer className="p-4 md:p-6 border-t border-zinc-900 bg-zinc-950/50 backdrop-blur-md shrink-0">
        <div className="max-w-4xl mx-auto mb-2">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Tip: Taip <span className="text-violet-500">/ai [soalan]</span> untuk bertanya kepada Gemini 3.1</p>
        </div>
        <form 
          onSubmit={handleSendMessage}
          className="max-w-4xl mx-auto flex gap-3"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Tulis mesej atau /ai untuk bantuan..."
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isAiLoading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-emerald-900/20 active:scale-95"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </footer>
    </div>
  );
}
