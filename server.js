// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // 🔒 change to your Next.js frontend domain in production
    methods: ["GET", "POST"],
  },
});

// Track active rooms and participants
const activeRooms = new Map();

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on("join-room", (roomId) => {
    // Leave previous rooms
    const oldRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    oldRooms.forEach(r => socket.leave(r));

    socket.join(roomId);

    if (!activeRooms.has(roomId)) activeRooms.set(roomId, new Set());
    activeRooms.get(roomId).add(socket.id);

    console.log(`👤 ${socket.id} joined room ${roomId}`);

    // Notify others
    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("offer", ({ roomId, offer }) => {
    console.log(`📡 Offer from ${socket.id} → room ${roomId}`);
    socket.to(roomId).emit("offer", { offer, from: socket.id });
  });

  socket.on("answer", ({ roomId, answer }) => {
    console.log(`📡 Answer from ${socket.id} → room ${roomId}`);
    socket.to(roomId).emit("answer", { answer, from: socket.id });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { candidate, from: socket.id });
  });

  // Handle real-time transcript updates from candidate to interviewer
  socket.on("transcript-update", ({ roomId, transcript, timestamp }) => {
    console.log(`🎙️ Real-time transcript in room ${roomId}: ${transcript.substring(0, 50)}...`);
    // Send transcript to all other participants in the room (interviewer)
    socket.to(roomId).emit("transcript-update", {
      transcript,
      timestamp,
      from: socket.id
    });
  });

  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);
    for (const [roomId, participants] of activeRooms.entries()) {
      if (participants.delete(socket.id)) {
        socket.to(roomId).emit("user-left", socket.id);
        if (participants.size === 0) {
          activeRooms.delete(roomId);
          console.log(`🧹 Room ${roomId} cleaned up`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Signaling server running on port ${PORT}`));