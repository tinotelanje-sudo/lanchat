import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
    maxHttpBufferSize: 5e7, // 50 MB limit for file uploads
  });

  const PORT = 3000;

  // Endpoint to get local IP addresses for LAN connection
  app.get("/api/network-info", (req, res) => {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    
    for (const k in interfaces) {
      for (const k2 in interfaces[k]) {
        const address = interfaces[k]![k2];
        if (address.family === "IPv4" && !address.internal) {
          addresses.push(address.address);
        }
      }
    }
    
    res.json({ ips: addresses, port: PORT });
  });

  // Track connected users: socketId -> username
  const users: Record<string, string> = {};

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("user_join", (username) => {
      users[socket.id] = username;
      const userList = Object.entries(users).map(([id, name]) => ({ id, username: name }));
      io.emit("update_user_list", userList);
    });

    socket.on("send_message", (data) => {
      // Broadcast message to all clients
      io.emit("receive_message", {
        ...data,
        timestamp: new Date().toLocaleTimeString(),
        reactions: {},
      });
    });

    socket.on("add_reaction", ({ messageId, emoji, username }) => {
      // Broadcast the reaction to all clients
      io.emit("update_reaction", { messageId, emoji, username });
    });

    // Typing Indicators
    socket.on("typing", (username) => {
      socket.broadcast.emit("user_typing", username);
    });

    socket.on("stop_typing", (username) => {
      socket.broadcast.emit("user_stop_typing", username);
    });

    // WebRTC Signaling
    socket.on("call_user", ({ userToCall, signalData, from, name, callType }) => {
      io.to(userToCall).emit("incoming_call", { signal: signalData, from, name, callType });
    });

    socket.on("answer_call", ({ to, signal }) => {
      io.to(to).emit("call_accepted", signal);
    });

    socket.on("ice_candidate", ({ to, candidate }) => {
      io.to(to).emit("ice_candidate", candidate);
    });

    socket.on("end_call", ({ to }) => {
      io.to(to).emit("call_ended");
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      delete users[socket.id];
      const userList = Object.entries(users).map(([id, name]) => ({ id, username: name }));
      io.emit("update_user_list", userList);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
