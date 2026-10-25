import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { GridFSBucket, ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB for this local prototype

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "2mb" }));

const { Schema } = mongoose;

// -------------------- DATABASE MODELS --------------------
const User = mongoose.model("User", new Schema({
  username: { type: String, unique: true, required: true, trim: true },
  email: { type: String, unique: true, required: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["student", "tutor"], default: "student" },
  bio: { type: String, default: "" },
  subjects: [String],
}, { timestamps: true }));

const Course = mongoose.model("Course", new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  subject: { type: String, default: "General" },
  level: { type: String, default: "Beginner" },
  tutor: { type: Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true }));

const Lecture = mongoose.model("Lecture", new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  videoUrl: { type: String, required: true },
  videoFileId: { type: Schema.Types.ObjectId, required: true },
  videoFilename: { type: String, required: true },
  videoContentType: { type: String, required: true },
  videoSize: { type: Number, required: true },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  tutor: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true }));

const Assignment = mongoose.model("Assignment", new Schema({
  title: { type: String, required: true, trim: true },
  instructions: { type: String, required: true },
  dueDate: { type: Date, default: null },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  tutor: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true }));

const TutorChoice = mongoose.model("TutorChoice", new Schema({
  student: { type: Schema.Types.ObjectId, ref: "User", unique: true, required: true },
  tutor: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true }));

const Quiz = mongoose.model("Quiz", new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  tutor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  questions: [{
    prompt: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctIndex: { type: Number, required: true, min: 0 },
  }],
}, { timestamps: true }));

const QuizAttempt = mongoose.model("QuizAttempt", new Schema({
  student: { type: Schema.Types.ObjectId, ref: "User", required: true },
  quiz: { type: Schema.Types.ObjectId, ref: "Quiz", required: true },
  answers: [{ type: Number }],
  score: { type: Number, required: true },
  total: { type: Number, required: true },
  percentage: { type: Number, required: true },
}, { timestamps: true }));

let videoBucket;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("video/")) {
      return cb(new Error("Choose a video file."));
    }
    cb(null, true);
  },
});

// -------------------- AUTH HELPERS --------------------
const safeUser = (u) => ({
  id: String(u._id), username: u.username, email: u.email,
  role: u.role, bio: u.bio || "", subjects: u.subjects || [],
});
const tokenFor = (u) => jwt.sign(
  { id: String(u._id), role: u.role, username: u.username },
  process.env.JWT_SECRET,
  { expiresIn: "7d" }
);

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ message: "Please sign in." });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Please sign in again." });
  }
}
function tutorOnly(req, res, next) {
  if (req.user.role !== "tutor") return res.status(403).json({ message: "Tutor access only." });
  next();
}
function videoTokenAuth(req, res, next) {
  const headerToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const token = headerToken || String(req.query.token || "");
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Sign in to watch this video." });
  }
}
const populateLecture = (query) => query.populate("course", "title").populate("tutor", "username");

// -------------------- HEALTH --------------------
app.get("/api/health", (_req, res) => res.json({
  ok: true,
  database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
}));

// -------------------- REGISTER / LOGIN --------------------
app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = req.body.role === "tutor" ? "tutor" : "student";
    if (username.length < 3 || !email.includes("@") || password.length < 8) {
      return res.status(400).json({ message: "Use a username with 3+ characters, a valid email, and a password with 8+ characters." });
    }
    const user = await User.create({ username, email, passwordHash: await bcrypt.hash(password, 12), role });
    res.status(201).json({ token: tokenFor(user), user: safeUser(user) });
  } catch (e) {
    res.status(e.code === 11000 ? 409 : 500).json({ message: e.code === 11000 ? "Username or email already exists." : "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const login = String(req.body.login || req.body.email || req.body.username || "").trim().toLowerCase();
    const user = await User.findOne({ $or: [{ email: login }, { username: login }] });
    if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.passwordHash))) {
      return res.status(401).json({ message: "Incorrect login or password." });
    }
    res.json({ token: tokenFor(user), user: safeUser(user) });
  } catch {
    res.status(500).json({ message: "Login failed." });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Account not found." });
    res.json({ user: safeUser(user) });
  } catch { res.status(500).json({ message: "Could not load account." }); }
});

// -------------------- TUTOR CHOICE --------------------
app.get("/api/tutors", auth, async (_req, res) => {
  try {
    const tutors = await User.find({ role: "tutor" }).select("username bio subjects");
    res.json(tutors.map(t => ({ _id: t._id, id: t._id, username: t.username, bio: t.bio, subjects: t.subjects })));
  } catch { res.status(500).json({ message: "Could not load tutors." }); }
});

async function saveTutorChoice(req, res) {
  try {
    if (req.user.role !== "student") return res.status(403).json({ message: "Students only." });
    const tutorId = req.body.tutorId;
    const selected = await User.findOne({ _id: tutorId, role: "tutor" });
    if (!selected) return res.status(404).json({ message: "Tutor not found." });
    await TutorChoice.findOneAndUpdate({ student: req.user.id }, { student: req.user.id, tutor: selected._id }, { upsert: true, new: true });
    res.json({ message: "Tutor selected.", tutor: { _id: selected._id, username: selected.username, bio: selected.bio, subjects: selected.subjects } });
  } catch { res.status(400).json({ message: "Could not save tutor selection." }); }
}
app.post("/api/tutors/select", auth, saveTutorChoice);
app.put("/api/tutor-choice", auth, saveTutorChoice);

async function getTutorChoice(req, res) {
  try {
    const choice = await TutorChoice.findOne({ student: req.user.id }).populate("tutor", "username bio subjects");
    res.json({ tutor: choice?.tutor ? { _id: choice.tutor._id, id: choice.tutor._id, username: choice.tutor.username, bio: choice.tutor.bio, subjects: choice.tutor.subjects } : null });
  } catch { res.status(500).json({ message: "Could not load tutor choice." }); }
}
app.get("/api/tutors/selected", auth, getTutorChoice);
app.get("/api/tutor-choice", auth, getTutorChoice);

// -------------------- COURSES --------------------
app.get("/api/courses", auth, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === "tutor") {
      filter = { $or: [{ tutor: null }, { tutor: req.user.id }] };
    } else {
      const choice = await TutorChoice.findOne({ student: req.user.id });
      filter = choice
        ? { $or: [{ tutor: null }, { tutor: choice.tutor }] }
        : { tutor: null };
    }
    res.json(await Course.find(filter).populate("tutor", "username").sort({ title: 1 }));
  } catch { res.status(500).json({ message: "Could not load courses." }); }
});

app.post("/api/courses", auth, tutorOnly, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ message: "Course title required." });
    const course = await Course.create({
      title, description: String(req.body.description || ""),
      subject: String(req.body.subject || "General"),
      level: String(req.body.level || "Beginner"), tutor: req.user.id,
    });
    res.status(201).json(course);
  } catch { res.status(400).json({ message: "Could not create course." }); }
});

// -------------------- LECTURES / VIDEO UPLOAD --------------------
app.get("/api/lectures", auth, async (req, res) => {
  try {
    let filter;
    if (req.user.role === "tutor") filter = { tutor: req.user.id };
    else {
      const choice = await TutorChoice.findOne({ student: req.user.id });
      filter = choice ? { tutor: choice.tutor } : { _id: { $exists: false } };
    }
    res.json(await populateLecture(Lecture.find(filter).sort({ createdAt: -1 })));
  } catch { res.status(500).json({ message: "Could not load lectures." }); }
});

app.post("/api/lectures/upload", auth, tutorOnly, (req, res, next) => {
  upload.single("video")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "Video must be 100 MB or smaller." : err.message || "Video upload failed." });
    next();
  });
}, async (req, res) => {
  let uploadedId;
  try {
    const title = String(req.body.title || "").trim();
    const courseId = req.body.courseId;
    if (!title || !courseId || !req.file) return res.status(400).json({ message: "Lecture title, course and video file are required." });
    const course = await Course.findOne({ _id: courseId, $or: [{ tutor: null }, { tutor: req.user.id }] });
    if (!course) return res.status(400).json({ message: "Choose a valid course available to your tutor account." });
    const videoUpload = videoBucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
      metadata: { contentType: req.file.mimetype, originalName: req.file.originalname, uploadedBy: req.user.id },
    });
    uploadedId = videoUpload.id;
    await new Promise((resolve, reject) => {
      videoUpload.once("finish", resolve);
      videoUpload.once("error", reject);
      videoUpload.end(req.file.buffer);
    });
    const lecture = await Lecture.create({
      title, description: String(req.body.description || ""),
      videoUrl: `/api/videos/${uploadedId.toString()}`,
      videoFileId: uploadedId,
      videoFilename: req.file.originalname,
      videoContentType: req.file.mimetype,
      videoSize: req.file.size,
      course: course._id,
      tutor: req.user.id,
    });
    res.status(201).json({ message: "Video uploaded and stored in MongoDB.", lecture: await populateLecture(Lecture.findById(lecture._id)) });
  } catch (e) {
    if (uploadedId && videoBucket) videoBucket.delete(uploadedId).catch(() => {});
    console.error("Video upload failed:", e.message);
    res.status(500).json({ message: "Video upload failed. Check the file and MongoDB connection." });
  }
});

// Streams video files from MongoDB GridFS. The token query parameter is used by the HTML video player.
app.get("/api/videos/:id", videoTokenAuth, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid video ID." });
    const id = new ObjectId(req.params.id);
    const lecture = await Lecture.findOne({ videoFileId: id });
    if (!lecture) return res.status(404).json({ message: "Video not found." });
    if (req.user.role === "tutor" && String(lecture.tutor) !== String(req.user.id)) {
      return res.status(403).json({ message: "You cannot watch another tutor's private video." });
    }
    if (req.user.role === "student") {
      const choice = await TutorChoice.findOne({ student: req.user.id });
      if (!choice || String(choice.tutor) !== String(lecture.tutor)) {
        return res.status(403).json({ message: "Choose this tutor before watching the video." });
      }
    }
    const file = await videoBucket.find({ _id: id }).next();
    if (!file) return res.status(404).json({ message: "Video file not found." });
    const contentType = file.metadata?.contentType || file.contentType || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return res.status(416).end();
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : file.length - 1;
      if (!match[1] && match[2]) { const suffix = Number(match[2]); start = Math.max(0, file.length - suffix); end = file.length - 1; }
      if (start >= file.length || end < start) return res.status(416).end();
      end = Math.min(end, file.length - 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${file.length}`);
      res.setHeader("Content-Length", end - start + 1);
      videoBucket.openDownloadStream(id, { start, end: end + 1 }).on("error", () => { if (!res.headersSent) res.sendStatus(404); else res.end(); }).pipe(res);
    } else {
      res.setHeader("Content-Length", file.length);
      videoBucket.openDownloadStream(id).on("error", () => { if (!res.headersSent) res.sendStatus(404); else res.end(); }).pipe(res);
    }
  } catch { res.status(500).json({ message: "Could not stream video." }); }
});

// -------------------- ASSIGNMENTS --------------------
app.get("/api/assignments", auth, async (req, res) => {
  try {
    let filter;
    if (req.user.role === "tutor") filter = { tutor: req.user.id };
    else {
      const choice = await TutorChoice.findOne({ student: req.user.id });
      filter = choice ? { tutor: choice.tutor } : { _id: { $exists: false } };
    }
    res.json(await Assignment.find(filter).populate("course", "title").populate("tutor", "username").sort({ createdAt: -1 }));
  } catch { res.status(500).json({ message: "Could not load assignments." }); }
});
app.post("/api/assignments", auth, tutorOnly, async (req, res) => {
  try {
    const { title, instructions, dueDate, courseId } = req.body;
    if (!String(title || "").trim() || !String(instructions || "").trim() || !courseId) return res.status(400).json({ message: "Title, instructions and course are required." });
    const course = await Course.findOne({ _id: courseId, $or: [{ tutor: null }, { tutor: req.user.id }] });
    if (!course) return res.status(400).json({ message: "Choose a valid course." });
    const assignment = await Assignment.create({ title: title.trim(), instructions: instructions.trim(), dueDate: dueDate || null, course: course._id, tutor: req.user.id });
    res.status(201).json(assignment);
  } catch { res.status(400).json({ message: "Could not create assignment." }); }
});

// -------------------- QUIZZES --------------------
function safeQuiz(q, includeAnswers = false) {
  return {
    _id: q._id, title: q.title, description: q.description,
    course: q.course, tutor: q.tutor,
    questions: q.questions.map(question => includeAnswers
      ? { prompt: question.prompt, options: question.options, correctIndex: question.correctIndex }
      : { prompt: question.prompt, options: question.options }),
    questionCount: q.questions.length,
  };
}
app.get("/api/quizzes", auth, async (req, res) => {
  try {
    let filter;
    if (req.user.role === "tutor") filter = { tutor: req.user.id };
    else {
      const choice = await TutorChoice.findOne({ student: req.user.id });
      filter = choice ? { tutor: choice.tutor } : { _id: { $exists: false } };
    }
    const quizzes = await Quiz.find(filter).populate("course", "title").populate("tutor", "username").sort({ createdAt: -1 });
    res.json(quizzes.map(q => safeQuiz(q, false)));
  } catch { res.status(500).json({ message: "Could not load quizzes." }); }
});
app.get("/api/quizzes/:id", auth, async (req, res) => {
  try {
    const q = await Quiz.findById(req.params.id).populate("course", "title").populate("tutor", "username");
    if (!q) return res.status(404).json({ message: "Quiz not found." });
    if (req.user.role === "student") {
      const choice = await TutorChoice.findOne({ student: req.user.id });
      if (!choice || String(choice.tutor) !== String(q.tutor?._id || q.tutor)) return res.status(403).json({ message: "Choose the quiz creator as your tutor first." });
    } else if (String(q.tutor?._id || q.tutor) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only open your own quizzes." });
    }
    res.json(safeQuiz(q, false));
  } catch { res.status(400).json({ message: "Could not open quiz." }); }
});
app.post("/api/quizzes", auth, tutorOnly, async (req, res) => {
  try {
    const { title, description = "", courseId, questions } = req.body;
    if (!String(title || "").trim() || !courseId || !Array.isArray(questions) || !questions.length) return res.status(400).json({ message: "Quiz title, course and at least one question are required." });
    const course = await Course.findOne({ _id: courseId, $or: [{ tutor: null }, { tutor: req.user.id }] });
    if (!course) return res.status(400).json({ message: "Choose a valid course." });
    for (const q of questions) {
      if (!String(q.prompt || "").trim() || !Array.isArray(q.options) || q.options.length < 2 || q.options.some(x => !String(x).trim()) || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        return res.status(400).json({ message: "Each question needs a prompt, at least two options, and a valid correct answer." });
      }
    }
    const quiz = await Quiz.create({ title: title.trim(), description, course: course._id, tutor: req.user.id, questions });
    res.status(201).json({ message: "Quiz saved to MongoDB.", quiz: safeQuiz(quiz, false) });
  } catch { res.status(400).json({ message: "Could not create quiz." }); }
});
app.post("/api/quizzes/:id/submit", auth, async (req, res) => {
  try {
    if (req.user.role !== "student") return res.status(403).json({ message: "Only students can submit quiz attempts." });
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found." });
    const choice = await TutorChoice.findOne({ student: req.user.id });
    if (!choice || String(choice.tutor) !== String(quiz.tutor)) return res.status(403).json({ message: "Choose this quiz's tutor first." });
    const answers = req.body.answers;
    if (!Array.isArray(answers) || answers.length !== quiz.questions.length) return res.status(400).json({ message: "Answer every question before submitting." });
    const score = quiz.questions.reduce((sum, q, i) => sum + (Number(answers[i]) === q.correctIndex ? 1 : 0), 0);
    const total = quiz.questions.length;
    const attempt = await QuizAttempt.create({ student: req.user.id, quiz: quiz._id, answers, score, total, percentage: Math.round((score / total) * 100) });
    res.json({ message: "Quiz submitted.", score, total, percentage: attempt.percentage, attemptId: attempt._id });
  } catch { res.status(500).json({ message: "Could not submit quiz." }); }
});
app.get("/api/results", auth, async (req, res) => {
  try {
    const results = await QuizAttempt.find({ student: req.user.id }).populate("quiz", "title").sort({ createdAt: -1 }).limit(100);
    res.json(results);
  } catch { res.status(500).json({ message: "Could not load quiz results." }); }
});

app.use((err, _req, res, _next) => {
  console.error("Request error:", err.message);
  res.status(500).json({ message: "Unexpected server error." });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI in server/.env");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) throw new Error("Set JWT_SECRET to a secret with at least 24 characters.");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  videoBucket = new GridFSBucket(mongoose.connection.db, { bucketName: "videos" });
  console.log("MongoDB connected:", mongoose.connection.name);

  // Add sample courses only if the database has no courses at all.
  if (await Course.countDocuments() === 0) {
    await Course.insertMany([
      { title: "Web Development Basics", description: "HTML, CSS and JavaScript fundamentals", subject: "Technology", level: "Beginner", tutor: null },
      { title: "Programming with Java", description: "Variables, conditions, loops and methods", subject: "Programming", level: "Beginner", tutor: null },
      { title: "Introduction to Data Science", description: "Explore data and beginner machine learning", subject: "Data Science", level: "Beginner", tutor: null },
    ]);
    console.log("Sample courses inserted.");
  }
  app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));
}
start().catch(error => { console.error("Server startup failed:", error.message); process.exit(1); });
