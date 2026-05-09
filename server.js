// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"],
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
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

    const roomSize = activeRooms.get(roomId).size;
    console.log(`👤 ${socket.id} joined room ${roomId} (${roomSize} users)`);

    // Notify others that a new user joined
    socket.to(roomId).emit("user-joined", socket.id);

    // Emit room-users event to all in room
    io.to(roomId).emit("room-users", {
      count: roomSize,
      users: Array.from(activeRooms.get(roomId))
    });

    // 🔥 When second user joins → trigger call start
    if (roomSize === 2) {
      console.log(`🚀 Both users ready in room ${roomId}, triggering ready-to-call`);
      io.to(roomId).emit("ready-to-call");
    }
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
  socket.on("transcript-update", ({ roomId, transcript, timestamp, questionId, questionText }) => {
    console.log(`🎙️ Real-time transcript in room ${roomId}: ${(transcript || "").substring(0, 50)}...`);
    // Send transcript to all other participants in the room (interviewer)
    socket.to(roomId).emit("transcript-update", {
      transcript,
      timestamp,
      questionId: questionId ?? null,
      questionText: questionText ?? "",
      from: socket.id
    });
  });

  // Handle question asked by interviewer
  socket.on("question-asked", ({ roomId, question, previousQuestionId, previousQuestionText }) => {
    console.log(`❓ Question asked in room ${roomId}: ${question.questiontext?.substring(0, 50)}...`);
    // Broadcast question to all other participants (interviewee)
    socket.to(roomId).emit("question-asked", {
      question,
      previousQuestionId: previousQuestionId ?? null,
      previousQuestionText: previousQuestionText ?? "",
      from: socket.id
    });
  });

  // Typed answer sync (candidate ↔ interviewer)
  socket.on("typed-answer-update", ({ roomId, questionId, typedAnswer, meta, timestamp }) => {
    socket.to(roomId).emit("typed-answer-update", {
      questionId,
      typedAnswer,
      meta: meta ?? null,
      timestamp,
      from: socket.id
    });
  });

  // Typed answers flush handshake before report generation
  socket.on("request-typed-answers", ({ roomId, requestId }) => {
    socket.to(roomId).emit("request-typed-answers", {
      requestId,
      from: socket.id
    });
  });

  socket.on("typed-answers-response", ({ roomId, requestId, typedMap, typedMetaMap, status, timestamp }) => {
    socket.to(roomId).emit("typed-answers-response", {
      requestId,
      typedMap,
      typedMetaMap: typedMetaMap ?? null,
      status,
      timestamp,
      from: socket.id
    });
  });

  // Transcription flush handshake before report generation
  socket.on("force-transcription-flush", ({ roomId, reason }) => {
    socket.to(roomId).emit("force-transcription-flush", { reason, from: socket.id });
  });

  socket.on("transcription-flush-ack", ({ roomId, requestId, status }) => {
    socket.to(roomId).emit("transcription-flush-ack", { requestId, status, from: socket.id });
  });

  // Handle answer submitted by interviewee
  socket.on("answer-submitted", ({ roomId, questionId, transcript }) => {
    console.log(`✅ Answer submitted in room ${roomId} for question ${questionId}`);
    // Notify interviewer that answer is ready
    socket.to(roomId).emit("answer-submitted", {
      questionId,
      transcript,
      from: socket.id
    });
  });

  // Handle plagiarism result from interviewer
  socket.on("plagiarism-result", ({ roomId, questionId, score, interpretation }) => {
    console.log(`📊 Plagiarism score in room ${roomId}: ${score}%`);
    // Send result to all participants
    socket.to(roomId).emit("plagiarism-result", {
      questionId,
      score,
      interpretation,
      from: socket.id
    });
  });

  // Tab / window focus loss (candidate ↔ interviewer integrity sync)
  socket.on("tab-switch-detected", ({ roomId, count, timestamp, role }) => {
    if (!roomId) return;
    // Only candidate tab switches are monitored / forwarded
    if (role !== "candidate") return;
    socket.to(roomId).emit("tab-switch-detected", {
      count,
      timestamp,
      role: "candidate",
      from: socket.id,
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Signaling server is running',
    activeRooms: activeRooms.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
  console.log(`📡 Socket.IO ready for connections`);
  console.log(`🌐 CORS enabled for: http://localhost:3000, http://localhost:3001`);
});
