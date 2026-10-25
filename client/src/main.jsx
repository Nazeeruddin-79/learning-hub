import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen, GraduationCap, LayoutDashboard, LogOut, PlayCircle,
  ClipboardList, Users, Plus, Search, Database, Video, ArrowRight,
  Brain, Trophy, UploadCloud, FileVideo, CheckCircle2, CircleHelp,
} from "lucide-react";
import "./styles.css";

const API = "http://localhost:5000/api";
const token = () => localStorage.getItem("lh_token");

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(API + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lh_user")); } catch { return null; }
  });
  const [page, setPage] = useState("Dashboard");
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState({ courses: [], tutors: [], selected: null, lectures: [], assignments: [], quizzes: [], results: [] });
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [questionCount, setQuestionCount] = useState(3);

  async function load() {
    if (!user) return;
    try {
      const [courses, tutors, selected, lectures, assignments, quizzes, results] = await Promise.all([
        api("/courses"), api("/tutors"), api("/tutors/selected"), api("/lectures"),
        api("/assignments"), api("/quizzes"), api("/results"),
      ]);
      setData({ courses, tutors, selected: selected.tutor, lectures, assignments, quizzes, results });
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, [user]);

  async function authenticate(event) {
    event.preventDefault(); setError(""); setNotice("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api(mode === "login" ? "/auth/login" : "/auth/register", {
        method: "POST", body: JSON.stringify(values),
      });
      localStorage.setItem("lh_token", result.token);
      localStorage.setItem("lh_user", JSON.stringify(result.user));
      setUser(result.user); setPage("Dashboard");
    } catch (e) { setError(e.message); }
  }

  function logout() {
    localStorage.removeItem("lh_token"); localStorage.removeItem("lh_user");
    setUser(null); setPage("Dashboard"); setActiveQuiz(null); setLastResult(null);
    setData({ courses: [], tutors: [], selected: null, lectures: [], assignments: [], quizzes: [], results: [] });
  }

  async function action(callback, message) {
    setError(""); setNotice("");
    try { await callback(); await load(); if (message) setNotice(message); }
    catch (e) { setError(e.message); }
  }

  async function submitJsonForm(event, path, message) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    await action(async () => { await api(path, { method: "POST", body: JSON.stringify(body) }); form.reset(); }, message);
  }

  async function uploadLecture(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("video");
    if (!(file instanceof File) || !file.size) { setError("Choose a video file first."); return; }
    if (file.size > 100 * 1024 * 1024) { setError("Video must be 100 MB or smaller."); return; }
    await action(async () => {
      await api("/lectures/upload", { method: "POST", body: fields });
      form.reset();
    }, "Video uploaded to MongoDB and lecture saved.");
  }

  async function createQuiz(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const questions = [];
    for (let i = 0; i < questionCount; i++) {
      const prompt = String(fields.get(`prompt${i}`) || "").trim();
      const options = String(fields.get(`options${i}`) || "").split("|").map(s => s.trim()).filter(Boolean);
      const correctIndex = Number(fields.get(`correct${i}`)) - 1;
      if (!prompt || options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
        setError(`Question ${i + 1}: enter a question, at least two options separated by |, and a valid correct-option number.`);
        return;
      }
      questions.push({ prompt, options, correctIndex });
    }
    const body = {
      title: fields.get("title"), description: fields.get("description"),
      courseId: fields.get("courseId"), questions,
    };
    await action(async () => { await api("/quizzes", { method: "POST", body: JSON.stringify(body) }); form.reset(); }, "Quiz saved to MongoDB.");
  }

  async function openQuiz(id) {
    setError(""); setLastResult(null);
    try {
      const quiz = await api(`/quizzes/${id}`);
      setActiveQuiz(quiz); setAnswers(Array(quiz.questions.length).fill(-1));
    } catch (e) { setError(e.message); }
  }

  async function submitQuiz(event) {
    event.preventDefault();
    if (answers.some(a => a < 0)) { setError("Answer every question before submitting."); return; }
    try {
      const result = await api(`/quizzes/${activeQuiz._id}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
      setLastResult({ ...result, title: activeQuiz.title }); setActiveQuiz(null); setAnswers([]);
      setNotice("Quiz submitted. Your score has been saved."); setError(""); await load();
    } catch (e) { setError(e.message); }
  }

  if (!user) {
    return <div className="login-page">
      <section className="hero">
        <div className="logo"><GraduationCap /> Learning Hub</div>
        <div><small>YOUR LEARNING SPACE</small><h1>Build skills.<br />One lesson at a time.</h1><p>Explore courses, watch tutor-uploaded videos, and test your knowledge with quizzes.</p></div>
        <div className="hero-foot">Learn at your pace · Grow every day</div>
      </section>
      <section className="login"><div className="login-box">
        <small>{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</small>
        <h2>{mode === "login" ? "Sign in to your account" : "Create your account"}</h2>
        <p>Accounts and learning data are saved in MongoDB Atlas.</p>
        <form onSubmit={authenticate}>
          {mode === "register" && <>
            <label>Username<input name="username" required minLength="3" placeholder="Your username" /></label>
            <label>Account type<select name="role" defaultValue="student"><option value="student">Student</option><option value="tutor">Tutor</option></select></label>
          </>}
          <label>{mode === "login" ? "Email or username" : "Email"}<input name={mode === "login" ? "login" : "email"} required type={mode === "login" ? "text" : "email"} placeholder={mode === "login" ? "Email or username" : "you@example.com"} /></label>
          <label>Password<input name="password" type="password" required minLength={mode === "register" ? 8 : undefined} placeholder="At least 8 characters" /></label>
          {error && <div className="error">{error}</div>}
          <button className="primary">{mode === "login" ? "Sign in" : "Create account"}<ArrowRight size={16} /></button>
        </form>
        <p className="switch">{mode === "login" ? "New to Learning Hub?" : "Already registered?"} <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create account" : "Sign in"}</button></p>
      </div></section>
    </div>;
  }

  const nav = [["Dashboard", LayoutDashboard], ["Courses", BookOpen], ["Find a Tutor", Users], ["Lectures", PlayCircle], ["Assignments", ClipboardList], ["Quizzes", Brain], ["My Results", Trophy]];
  const courses = data.courses.filter(c => `${c.title} ${c.subject} ${c.description}`.toLowerCase().includes(search.toLowerCase()));
  const tutorCourses = data.courses.filter(c => !c.tutor || String(c.tutor?._id || c.tutor) === String(user.id));

  return <div className="shell">
    <aside className="sidebar">
      <div className="logo"><GraduationCap /> Learning Hub</div>
      <small className="section-label">WORKSPACE</small>
      {nav.map(([name, Icon]) => <button key={name} className={`nav ${page === name ? "active" : ""}`} onClick={() => { setPage(name); setActiveQuiz(null); setLastResult(null); }}><Icon size={18} />{name}</button>)}
      <div className="side-bottom"><div className="db-pill"><span /> MongoDB Atlas connected</div><div className="user"><div className="avatar">{user.username[0].toUpperCase()}</div><div><b>{user.username}</b><small>{user.role}</small></div><button onClick={logout} title="Sign out"><LogOut size={16} /></button></div></div>
    </aside>
    <main><header><span>Workspace / <b>{page}</b></span><span className="role">{user.role} workspace</span></header>
      <div className="content">
        {error && <div className="error">{error}<button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="success">{notice}<button onClick={() => setNotice("")}>×</button></div>}
        {user.role === "student" && !data.selected && <div className="prompt"><Users /><div><b>Choose your tutor</b><p>Select a tutor to see their lectures, assignments and quizzes.</p></div><button className="primary" onClick={() => setPage("Find a Tutor")}>Find a tutor</button></div>}

        {page === "Dashboard" && <>
          <small className="kicker">YOUR LEARNING OVERVIEW</small><h1>{user.role === "tutor" ? "Tutor dashboard" : `Welcome, ${user.username}`}</h1>
          <p className="muted">{user.role === "tutor" ? "Manage courses, upload videos, create assignments and build quizzes." : "Explore courses, watch lectures and test your understanding."}</p>
          <div className="stats"><Stat icon={BookOpen} title="Courses" n={data.courses.length} /><Stat icon={Video} title="Lectures" n={data.lectures.length} /><Stat icon={ClipboardList} title="Assignments" n={data.assignments.length} /><Stat icon={Brain} title="Quizzes" n={data.quizzes.length} /></div>
          <div className="heading"><div><h2>Explore courses</h2><p>Course information is loaded from MongoDB.</p></div><button className="link" onClick={() => setPage("Courses")}>View all →</button></div>
          <div className="cards">{data.courses.slice(0, 3).map((c, i) => <Course key={c._id} course={c} index={i} go={() => setPage("Courses")} />)}</div>
        </>}

        {page === "Courses" && <>
          <Title k="COURSE CATALOG" title="Explore courses" sub="Browse starter courses and courses created by tutors." />
          <div className="search"><Search /><input placeholder="Search courses..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          {user.role === "tutor" && <form className="creator" onSubmit={e => submitJsonForm(e, "/courses", "Course saved to MongoDB.")}><h3><Plus size={17} /> Add a course</h3><div className="fields"><label>Course title<input name="title" required /></label><label>Subject<input name="subject" required /></label><label className="wide">Description<input name="description" /></label></div><button className="primary">Save course</button></form>}
          <div className="cards">{courses.map((c, i) => <Course key={c._id} course={c} index={i} go={() => setPage("Lectures")} />)}</div>
          {!courses.length && <Empty text="No matching courses found." />}
        </>}

        {page === "Find a Tutor" && <>
          <Title k="LEARN WITH GUIDANCE" title="Find your tutor" sub="Students choose a tutor to access that tutor's lectures, assignments and quizzes." />
          <div className="cards tutor-cards">{data.tutors.map(t => <div className="panel" key={t._id}><div className="tutor-avatar">{t.username[0].toUpperCase()}</div><h3>{t.username}</h3><p>{t.bio || "Learning guide on Learning Hub."}</p><div className="tags">{(t.subjects?.length ? t.subjects : ["General learning"]).map(s => <span key={s}>{s}</span>)}</div><button className="primary" onClick={() => action(() => api("/tutors/select", { method: "POST", body: JSON.stringify({ tutorId: t._id }) }), "Tutor selected.")}>{String(data.selected?._id) === String(t._id) ? "Selected" : "Choose tutor"}</button></div>)}</div>
          {!data.tutors.length && <Empty text="No tutors yet. Sign out and create an account with the Tutor role." />}
        </>}

        {page === "Lectures" && <>
          <Title k="WATCH & LEARN" title="Lecture library" sub={user.role === "tutor" ? "Upload a video file from your computer. The file itself is stored in MongoDB GridFS." : "Play videos uploaded by your selected tutor."} />
          {user.role === "tutor" && <form className="creator" onSubmit={uploadLecture} encType="multipart/form-data"><h3><UploadCloud size={17} /> Upload a video lecture</h3><div className="fields"><label>Lecture title<input name="title" required /></label><label>Course<select name="courseId" required defaultValue=""><option value="" disabled>Select course</option>{tutorCourses.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label><label>Description<input name="description" placeholder="What will students learn?" /></label><label>Video file<input name="video" type="file" accept="video/*" required /></label></div><p className="form-hint">Maximum size: 100 MB. MP4 is recommended for browser playback.</p><button className="primary"><UploadCloud size={16} /> Upload video and save lecture</button></form>}
          <div className="lecture-list">{data.lectures.map(lecture => <article className="video-card" key={lecture._id}><div className="video-heading"><FileVideo /><div><b>{lecture.title}</b><p>{lecture.course?.title || "Course"} · {lecture.tutor?.username || user.username}</p>{lecture.description && <p>{lecture.description}</p>}</div></div><video controls preload="metadata" src={`${API}/videos/${lecture.videoFileId}?token=${encodeURIComponent(token() || "")}`}><track kind="captions" /></video><small>{lecture.videoFilename} · {(lecture.videoSize / (1024 * 1024)).toFixed(1)} MB</small></article>)}</div>
          {!data.lectures.length && <Empty text={user.role === "tutor" ? "Upload your first video above." : "Choose a tutor, then their uploaded lectures will appear here."} />}
        </>}

        {page === "Assignments" && <>
          <Title k="PRACTICE & REVIEW" title="Assignments" sub={user.role === "tutor" ? "Create assignments for your courses." : "Review assignments shared by your selected tutor."} />
          {user.role === "tutor" && <form className="creator" onSubmit={e => submitJsonForm(e, "/assignments", "Assignment saved to MongoDB.")}><h3><Plus size={17} /> Create an assignment</h3><div className="fields"><label>Title<input name="title" required /></label><label>Course<select name="courseId" required defaultValue=""><option value="" disabled>Select course</option>{tutorCourses.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label><label className="wide">Instructions<textarea name="instructions" required rows="3" /></label><label>Due date<input type="date" name="dueDate" /></label></div><button className="primary">Save assignment</button></form>}
          <div className="assignments">{data.assignments.map(a => <div className="panel" key={a._id}><span className="assignment-icon"><ClipboardList /></span><small>{a.course?.title} · {a.tutor?.username}</small><h3>{a.title}</h3><p>{a.instructions}</p><small>{a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "No due date"}</small></div>)}</div>
          {!data.assignments.length && <Empty text={user.role === "tutor" ? "Create an assignment above." : "Assignments from your selected tutor will appear here."} />}
        </>}

        {page === "Quizzes" && <>
          <Title k="CHECK YOUR KNOWLEDGE" title="Quizzes" sub={user.role === "tutor" ? "Create multiple-choice quizzes for a course." : "Take quizzes made by your selected tutor. Scores are saved in MongoDB."} />
          {user.role === "tutor" && <form className="creator" onSubmit={createQuiz}><h3><Plus size={17} /> Create a quiz</h3><div className="fields"><label>Quiz title<input name="title" required /></label><label>Course<select name="courseId" required defaultValue=""><option value="" disabled>Select course</option>{tutorCourses.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label><label className="wide">Description<input name="description" /></label></div>
            {Array.from({ length: questionCount }, (_, i) => <div className="quiz-question-editor" key={i}><b>Question {i + 1}</b><label>Question text<input name={`prompt${i}`} required placeholder="Enter the question" /></label><label>Options, separated by |<input name={`options${i}`} required placeholder="Option A | Option B | Option C | Option D" /></label><label>Correct option number<input name={`correct${i}`} type="number" min="1" max="10" required placeholder="For example, 2" /></label></div>)}
            <div className="form-actions"><button type="button" className="secondary" onClick={() => setQuestionCount(n => Math.min(n + 1, 10))} disabled={questionCount >= 10}><Plus size={15} /> Add question</button><button type="button" className="secondary" onClick={() => setQuestionCount(n => Math.max(1, n - 1))} disabled={questionCount <= 1}>Remove last question</button><button className="primary"><Brain size={16} /> Save quiz</button></div>
          </form>}
          {activeQuiz && user.role === "student" && <form className="creator taking-quiz" onSubmit={submitQuiz}><h3><CircleHelp size={18} /> {activeQuiz.title}</h3><p>{activeQuiz.description}</p>{activeQuiz.questions.map((q, i) => <fieldset className="question-field" key={i}><legend>{i + 1}. {q.prompt}</legend>{q.options.map((option, j) => <label className="answer-option" key={j}><input type="radio" name={`answer-${i}`} checked={answers[i] === j} onChange={() => setAnswers(prev => prev.map((v, k) => k === i ? j : v))} /> {option}</label>)}</fieldset>)}<button className="primary">Submit answers</button><button type="button" className="secondary cancel-button" onClick={() => setActiveQuiz(null)}>Cancel</button></form>}
          {lastResult && <div className="quiz-result"><Trophy size={25} /><div><b>{lastResult.title}: {lastResult.score}/{lastResult.total}</b><p>You scored {lastResult.percentage}%. Your attempt has been saved.</p></div></div>}
          <div className="cards quiz-cards">{data.quizzes.map(q => <article className="panel quiz-card" key={q._id}><span className="assignment-icon"><Brain /></span><h3>{q.title}</h3><p>{q.description || "Multiple-choice quiz"}</p><small>{q.course?.title || "Course"} · {q.questionCount} question(s)</small>{user.role === "student" && <button className="primary" onClick={() => openQuiz(q._id)}>Start quiz <ArrowRight size={15} /></button>}{user.role === "tutor" && <small className="saved-label"><CheckCircle2 size={14} /> Saved in MongoDB</small>}</article>)}</div>
          {!data.quizzes.length && <Empty text={user.role === "tutor" ? "Create your first quiz above." : "Choose a tutor to see their quizzes."} />}
        </>}

        {page === "My Results" && <>
          <Title k="YOUR PROGRESS" title="Quiz results" sub="Your quiz attempts and scores are saved in MongoDB Atlas." />
          <div className="results-list">{data.results.map(r => <article className="row-card" key={r._id}><Trophy /><div><b>{r.quiz?.title || "Quiz"}</b><p>{r.score}/{r.total} correct · {r.percentage}% · {new Date(r.createdAt).toLocaleString()}</p></div><span className="score-pill">{r.percentage}%</span></article>)}</div>
          {!data.results.length && <Empty text="Your completed quiz attempts will appear here." />}
        </>}
      </div>
      <footer><span>Learning Hub · Prototype</span><span><Database size={14} /> Data saved in MongoDB Atlas</span></footer>
    </main>
  </div>;
}

function Stat({ icon: Icon, title, n }) { return <div className="stat"><Icon /><div><small>{title}</small><b>{n}</b></div></div>; }
function Title({ k, title, sub }) { return <div className="title"><small className="kicker">{k}</small><h1>{title}</h1><p>{sub}</p></div>; }
function Course({ course, index, go }) { return <button className="course" onClick={go}><div className={`cover cover${index % 4}`}><BookOpen size={28} /><span>{course.subject || "General"}</span></div><div className="course-body"><small>{course.tutor ? "TUTOR COURSE" : "STARTER COURSE"}</small><h3>{course.title}</h3><p>{course.description}</p><div className="course-foot">{course.tutor?.username || "Learning Hub"}<span>View lectures →</span></div></div></button>; }
function Empty({ text }) { return <div className="empty"><BookOpen /><p>{text}</p></div>; }

createRoot(document.getElementById("root")).render(<App />);
