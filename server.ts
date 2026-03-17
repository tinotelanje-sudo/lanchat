import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // Track connected users: socketId -> username
  const users: Record<string, string> = {};

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("user_join", (username) => {
      users[socket.id] = username;
      io.emit("update_user_list", Object.values(users));
    });

    socket.on("send_message", (data) => {
      // Broadcast message to all clients
      io.emit("receive_message", {
        ...data,
        timestamp: new Date().toLocaleTimeString(),
      });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      delete users[socket.id];
      io.emit("update_user_list", Object.values(users));
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
