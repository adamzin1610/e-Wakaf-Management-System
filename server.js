const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SIGNUP_CODE = process.env.ADMIN_SIGNUP_CODE || "EWAKAF-ADMIN-2026";

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "ewakaf.db"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  ic_number TEXT,
  contact_no TEXT,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','applicant','donor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aid_applications (
  application_id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  target_amount REAL NOT NULL CHECK(target_amount >= 0),
  description TEXT NOT NULL,
  document_path TEXT,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK(status IN ('Pending','Under Review','Approved','Rejected')),
  admin_note TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(applicant_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  target_amount REAL NOT NULL CHECK(target_amount > 0),
  current_amount REAL NOT NULL DEFAULT 0,
  closing_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active'
    CHECK(status IN ('Active','Closed','Draft')),
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(application_id) REFERENCES aid_applications(application_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS donations (
  donation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'Paid',
  payment_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_no TEXT PRIMARY KEY,
  donation_id INTEGER UNIQUE NOT NULL,
  issue_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount REAL NOT NULL,
  FOREIGN KEY(donation_id) REFERENCES donations(donation_id) ON DELETE CASCADE
);
`);

// Keep the seeded Surau campaign image available locally so it does not depend on an external image host.
db.prepare("UPDATE campaigns SET image_url=? WHERE title=? AND image_url=?").run("/images/build-new-surau.svg", "Build a New Surau", "https://images.unsplash.com/photo-1564769625392-651b89c4a5d0?auto=format&fit=crop&w=1000&q=80");

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count === 0) {
    const adminHash = bcrypt.hashSync("Admin@123", 10);
    const applicantHash = bcrypt.hashSync("Applicant@123", 10);

    const insertUser = db.prepare(`
      INSERT INTO users (username,password_hash,full_name,ic_number,contact_no,email,role)
      VALUES (?,?,?,?,?,?,?)
    `);

    insertUser.run("admin", adminHash, "Surau Administrator", null, "0123456789", "admin@ewakaf.local", "admin");
    insertUser.run("applicant", applicantHash, "Ahmad Applicant", "900101-01-1234", "0132223333", "applicant@ewakaf.local", "applicant");

    const applicant = db.prepare("SELECT user_id FROM users WHERE username='applicant'").get();
    const insertApp = db.prepare(`
      INSERT INTO aid_applications
      (applicant_id,title,category,target_amount,description,status)
      VALUES (?,?,?,?,?,?)
    `);
    const app1 = insertApp.run(
      applicant.user_id,
      "Medical Assistance for Treatment",
      "Medical",
      10000,
      "Financial assistance is requested for medical treatment and related expenses.",
      "Approved"
    );

    const insertCampaign = db.prepare(`
      INSERT INTO campaigns
      (application_id,title,objective,target_amount,current_amount,closing_date,status,image_url)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    insertCampaign.run(
      app1.lastInsertRowid,
      "Medical Assistance Fund",
      "Support medical treatment and essential expenses for a local community member.",
      10000,
      4250,
      "2026-12-31",
      "Active",
      "https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=1000&q=80"
    );

    insertCampaign.run(
      null,
      "Build a New Surau",
      "Raise funds to improve a community prayer and learning facility.",
      100000,
      72000,
      "2027-03-31",
      "Active",
      "/images/build-new-surau.svg"
    );

    insertCampaign.run(
      null,
      "Education Support",
      "Provide educational assistance, supplies and learning support to families in need.",
      80000,
      45000,
      "2027-01-31",
      "Active",
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1000&q=80"
    );

    insertCampaign.run(
      null,
      "Quran Distribution",
      "Distribute Al-Quran copies and learning materials to community members.",
      50000,
      15000,
      "2026-11-30",
      "Active",
      "https://images.unsplash.com/photo-1609599006353-e629aaabfeae?auto=format&fit=crop&w=1000&q=80"
    );
  }
}
seed();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-session-secret-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 1000 * 60 * 60 * 4 },
  rolling: true
}));

app.locals.money = n => `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
app.locals.formatDate = value => value ? new Date(value).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "-";
app.locals.progress = (current, target) => Math.min(100, target ? (current / target) * 100 : 0).toFixed(0);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).json({ ok: false, message: "You do not have permission to access this page." });
    }
    next();
  };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});


// =========================
// REST API
// =========================

app.get("/api/session", (req, res) => {
  res.json({ ok: true, user: req.session.user || null });
});

app.get("/api/campaigns", (req, res) => {
  const q = String(req.query.q || "").trim();
  const category = String(req.query.category || "").trim();
  let sql = "SELECT * FROM campaigns WHERE status='Active'";
  const params = {};
  if (q) { sql += " AND (title LIKE @q OR objective LIKE @q)"; params.q = `%${q}%`; }
  if (category) { sql += " AND title LIKE @category"; params.category = `%${category}%`; }
  sql += " ORDER BY created_at DESC";
  res.json({ ok: true, campaigns: db.prepare(sql).all(params) });
});

app.get("/api/campaigns/:id", (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE campaign_id=?").get(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, message: "Campaign not found." });
  res.json({ ok: true, campaign });
});

app.post("/api/donate/:id", (req, res) => {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE campaign_id=? AND status='Active'").get(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, message: "Campaign is not available." });
  const { donorName, donorEmail, amount, paymentMethod } = req.body;
  const value = Number(amount);
  if (!donorName || !donorEmail || !Number.isFinite(value) || value <= 0 || !paymentMethod) {
    return res.status(400).json({ ok: false, message: "Please complete all donation fields with a valid amount." });
  }
  const receiptNo = db.transaction(() => {
    const donation = db.prepare(`
      INSERT INTO donations (campaign_id,donor_name,donor_email,amount,payment_method,payment_status)
      VALUES (?,?,?,?,?,'Paid')
    `).run(campaign.campaign_id, donorName.trim(), donorEmail.trim(), value, paymentMethod);
    db.prepare("UPDATE campaigns SET current_amount=current_amount+? WHERE campaign_id=?").run(value, campaign.campaign_id);
    const number = `RCP-${new Date().getFullYear()}-${String(donation.lastInsertRowid).padStart(7, "0")}`;
    db.prepare("INSERT INTO receipts(receipt_no,donation_id,amount) VALUES(?,?,?)").run(number, donation.lastInsertRowid, value);
    return number;
  })();
  res.json({ ok: true, receiptNo });
});

app.get("/api/receipts/:receiptNo", (req, res) => {
  const receipt = db.prepare(`
    SELECT r.*, d.donor_name, d.donor_email, d.amount AS donation_amount,
           d.payment_method, d.payment_status, d.payment_date, c.title AS campaign_title
    FROM receipts r JOIN donations d ON d.donation_id=r.donation_id
    JOIN campaigns c ON c.campaign_id=d.campaign_id WHERE r.receipt_no=?
  `).get(req.params.receiptNo);
  if (!receipt) return res.status(404).json({ ok: false, message: "Receipt not found." });
  res.json({ ok: true, receipt });
});

app.post("/api/register", (req, res) => {
  const { username, fullName, icNumber, contactNo, email, password, role, adminCode } = req.body;
  if (!username || !fullName || !email || !password || !["admin", "applicant"].includes(role)) {
    return res.status(400).json({ ok: false, message: "Please complete the required registration fields." });
  }
  if (role === "admin" && adminCode !== ADMIN_SIGNUP_CODE) {
    return res.status(400).json({ ok: false, message: "Invalid admin registration code." });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`INSERT INTO users(username,password_hash,full_name,ic_number,contact_no,email,role) VALUES(?,?,?,?,?,?,?)`)
      .run(username.trim(), hash, fullName.trim(), icNumber || null, contactNo || null, email.trim(), role);
    req.session.user = { user_id: result.lastInsertRowid, username: username.trim(), full_name: fullName.trim(), email: email.trim(), role };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message.includes("UNIQUE") ? "Username or email is already registered." : "Registration failed." });
  }
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE (username=? OR email=?) AND role IN ('admin','applicant')").get(username, username);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ ok: false, message: "Invalid username/email or password." });
  }
  req.session.user = { user_id: user.user_id, username: user.username, full_name: user.full_name, email: user.email, role: user.role };
  res.json({ ok: true, user: req.session.user, redirect: user.role === "admin" ? "/admin-dashboard.html" : "/aid-dashboard.html" });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/aid/dashboard", requireRole("applicant"), (req, res) => {
  const applications = db.prepare("SELECT * FROM aid_applications WHERE applicant_id=? ORDER BY submitted_at DESC").all(req.session.user.user_id);
  const stats = {
    total: applications.length,
    pending: applications.filter(a => ["Pending", "Under Review"].includes(a.status)).length,
    approved: applications.filter(a => a.status === "Approved").length,
    rejected: applications.filter(a => a.status === "Rejected").length
  };
  res.json({ ok: true, applications, recent: applications.slice(0, 5), stats, user: req.session.user });
});

// Campaign progress belonging to the currently logged-in applicant only.
// A campaign is linked to an aid application through campaigns.application_id.
app.get("/api/aid/campaign-progress", requireRole("applicant"), (req, res) => {
  const campaigns = db.prepare(`
    SELECT
      c.campaign_id,
      c.application_id,
      c.title,
      c.objective,
      c.target_amount,
      c.current_amount,
      c.closing_date,
      c.status,
      c.image_url,
      a.title AS application_title,
      a.status AS application_status,
      COALESCE((SELECT COUNT(*) FROM donations d WHERE d.campaign_id = c.campaign_id AND d.payment_status = 'Paid'), 0) AS donation_count
    FROM campaigns c
    INNER JOIN aid_applications a ON a.application_id = c.application_id
    WHERE a.applicant_id = ?
    ORDER BY c.created_at DESC
  `).all(req.session.user.user_id);

  const items = campaigns.map(c => ({
    ...c,
    progress_percent: Number(c.target_amount) > 0
      ? Math.min(100, (Number(c.current_amount) / Number(c.target_amount)) * 100)
      : 0,
    remaining_amount: Math.max(0, Number(c.target_amount) - Number(c.current_amount))
  }));

  res.json({ ok: true, campaigns: items, user: req.session.user });
});

app.get("/api/aid/profile", requireRole("applicant"), (req, res) => {
  const profile = db.prepare("SELECT user_id, username, full_name, ic_number, contact_no, email, created_at FROM users WHERE user_id=? AND role='applicant'").get(req.session.user.user_id);
  if (!profile) return res.status(404).json({ ok: false, message: "Applicant profile not found." });
  res.json({ ok: true, profile });
});

app.put("/api/aid/profile", requireRole("applicant"), (req, res) => {
  const { fullName, icNumber, contactNo, email, password } = req.body;
  if (!fullName || !email) return res.status(400).json({ ok: false, message: "Full name and email are required." });
  if (password && password.length < 6) return res.status(400).json({ ok: false, message: "New password must be at least 6 characters." });
  try {
    if (password) {
      db.prepare("UPDATE users SET full_name=?, ic_number=?, contact_no=?, email=?, password_hash=? WHERE user_id=? AND role='applicant'")
        .run(fullName.trim(), icNumber || null, contactNo || null, email.trim(), bcrypt.hashSync(password, 10), req.session.user.user_id);
    } else {
      db.prepare("UPDATE users SET full_name=?, ic_number=?, contact_no=?, email=? WHERE user_id=? AND role='applicant'")
        .run(fullName.trim(), icNumber || null, contactNo || null, email.trim(), req.session.user.user_id);
    }
    req.session.user.full_name = fullName.trim(); req.session.user.email = email.trim();
    res.json({ ok: true, message: "Your profile has been updated.", user: req.session.user });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message.includes("UNIQUE") ? "That email is already registered." : "Profile update failed." });
  }
});

app.post("/api/aid/apply", requireRole("applicant"), upload.single("document"), (req, res) => {
  const { title, category, targetAmount, description } = req.body;
  const value = Number(targetAmount);
  if (!title || !category || !description || !Number.isFinite(value) || value < 0) {
    return res.status(400).json({ ok: false, message: "Please complete the aid application." });
  }
  const documentPath = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db.prepare(`INSERT INTO aid_applications (applicant_id,title,category,target_amount,description,document_path) VALUES(?,?,?,?,?,?)`)
    .run(req.session.user.user_id, title.trim(), category, value, description.trim(), documentPath);
  res.json({ ok: true, applicationId: result.lastInsertRowid, message: "Aid application submitted successfully." });
});

app.get("/api/aid/applications", requireRole("applicant"), (req, res) => {
  const applications = db.prepare("SELECT * FROM aid_applications WHERE applicant_id=? ORDER BY submitted_at DESC").all(req.session.user.user_id);
  res.json({ ok: true, applications });
});

app.get("/api/admin/dashboard", requireRole("admin"), (req, res) => {
  const stats = {
    campaigns: db.prepare("SELECT COUNT(*) c FROM campaigns").get().c,
    donations: db.prepare("SELECT COALESCE(SUM(amount),0) c FROM donations WHERE payment_status='Paid'").get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM aid_applications WHERE status IN ('Pending','Under Review')").get().c,
    applicants: db.prepare("SELECT COUNT(*) c FROM users WHERE role='applicant'").get().c
  };
  const donations = db.prepare("SELECT d.*, c.title campaign_title FROM donations d JOIN campaigns c ON c.campaign_id=d.campaign_id ORDER BY d.payment_date DESC LIMIT 8").all();
  res.json({ ok: true, stats, donations, user: req.session.user });
});

app.get("/api/admin/campaigns", requireRole("admin"), (req, res) => {
  res.json({ ok: true, campaigns: db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all() });
});

app.get("/api/admin/approved-applications", requireRole("admin"), (req, res) => {
  const applications = db.prepare(`
    SELECT a.application_id, a.title, a.target_amount, a.status, u.full_name,
           CASE WHEN EXISTS (SELECT 1 FROM campaigns c WHERE c.application_id = a.application_id) THEN 1 ELSE 0 END AS has_campaign
    FROM aid_applications a
    JOIN users u ON u.user_id = a.applicant_id
    WHERE a.status = 'Approved'
    ORDER BY a.updated_at DESC
  `).all();
  res.json({ ok: true, applications });
});

app.post("/api/admin/campaigns", requireRole("admin"), (req, res) => {
  const { title, objective, targetAmount, closingDate, imageUrl, applicationId } = req.body;
  const value = Number(targetAmount);
  if (!title || !objective || !Number.isFinite(value) || value <= 0 || !closingDate) return res.status(400).json({ ok: false, message: "Please enter valid campaign details." });

  let linkedApplicationId = null;
  if (applicationId) {
    const application = db.prepare("SELECT application_id FROM aid_applications WHERE application_id=? AND status='Approved'").get(applicationId);
    if (!application) return res.status(400).json({ ok: false, message: "The selected aid application is not approved or does not exist." });
    const existing = db.prepare("SELECT campaign_id FROM campaigns WHERE application_id=?").get(applicationId);
    if (existing) return res.status(400).json({ ok: false, message: "That aid application is already linked to a campaign." });
    linkedApplicationId = application.application_id;
  }

  const result = db.prepare("INSERT INTO campaigns(application_id,title,objective,target_amount,closing_date,status,image_url) VALUES(?,?,?,?,?, 'Active', ?)")
    .run(linkedApplicationId, title.trim(), objective.trim(), value, closingDate, imageUrl || null);
  res.json({ ok: true, campaignId: result.lastInsertRowid, message: "Campaign created." });
});

app.patch("/api/admin/campaigns/:id/status", requireRole("admin"), (req, res) => {
  if (!["Active", "Closed", "Draft"].includes(req.body.status)) return res.status(400).json({ ok: false, message: "Invalid campaign status." });
  db.prepare("UPDATE campaigns SET status=? WHERE campaign_id=?").run(req.body.status, req.params.id);
  res.json({ ok: true, message: "Campaign status updated." });
});

app.delete("/api/admin/campaigns/:id", requireRole("admin"), (req, res) => {
  try { db.prepare("DELETE FROM campaigns WHERE campaign_id=?").run(req.params.id); res.json({ ok: true, message: "Campaign deleted." }); }
  catch { res.status(400).json({ ok: false, message: "Campaign cannot be deleted because it has donation records." }); }
});

app.get("/api/admin/applications", requireRole("admin"), (req, res) => {
  const applications = db.prepare("SELECT a.*, u.full_name, u.email FROM aid_applications a JOIN users u ON u.user_id=a.applicant_id ORDER BY a.submitted_at DESC").all();
  res.json({ ok: true, applications });
});

app.patch("/api/admin/applications/:id/status", requireRole("admin"), (req, res) => {
  if (!["Pending", "Under Review", "Approved", "Rejected"].includes(req.body.status)) return res.status(400).json({ ok: false, message: "Invalid application status." });
  db.prepare("UPDATE aid_applications SET status=?, admin_note=?, updated_at=CURRENT_TIMESTAMP WHERE application_id=?").run(req.body.status, req.body.adminNote || null, req.params.id);
  res.json({ ok: true, message: "Application status updated." });
});

app.get("/api/admin/donations", requireRole("admin"), (req, res) => {
  const donations = db.prepare("SELECT d.*, c.title campaign_title, r.receipt_no FROM donations d JOIN campaigns c ON c.campaign_id=d.campaign_id LEFT JOIN receipts r ON r.donation_id=d.donation_id ORDER BY d.payment_date DESC").all();
  res.json({ ok: true, donations });
});


function pdfEscape(value) {
  return String(value ?? "").replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");
}
function makeSimplePdf(lines) {
  const wrapped = [];
  for (const line of lines) {
    const s = String(line ?? "");
    if (!s) { wrapped.push(""); continue; }
    for (let i = 0; i < s.length; i += 88) wrapped.push(s.slice(i, i + 88));
  }
  const content = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL",
    ...wrapped.flatMap((line, i) => i === 0 ? [`(${pdfEscape(line)}) Tj`] : ["T*", `(${pdfEscape(line)}) Tj`]),
    "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n", offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++)pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

app.get("/api/admin/reports", requireRole("admin"), (req, res) => {
  const totals = db.prepare("SELECT COALESCE(SUM(amount),0) total, COUNT(*) transactions FROM donations WHERE payment_status='Paid'").get();
  const campaigns = db.prepare("SELECT c.title, c.target_amount, c.current_amount, COUNT(d.donation_id) donation_count FROM campaigns c LEFT JOIN donations d ON d.campaign_id=c.campaign_id GROUP BY c.campaign_id ORDER BY c.current_amount DESC").all();
  res.json({ ok: true, totals, campaigns });
});

app.get("/api/admin/reports.csv", requireRole("admin"), (req, res) => {
  const rows = db.prepare("SELECT d.payment_date, d.donor_name, d.donor_email, c.title AS campaign, d.amount, d.payment_method, d.payment_status, r.receipt_no FROM donations d JOIN campaigns c ON c.campaign_id=d.campaign_id LEFT JOIN receipts r ON r.donation_id=d.donation_id ORDER BY d.payment_date DESC").all();
  const header = ["Date", "Donor Name", "Donor Email", "Campaign", "Amount", "Payment Method", "Status", "Receipt No"];
  const csv = [header, ...rows.map(r => [r.payment_date, r.donor_name, r.donor_email, r.campaign, r.amount, r.payment_method, r.payment_status, r.receipt_no || ""])]
    .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=ewakaf-financial-report.csv");
  res.send(csv);
});


app.get("/api/admin/reports.pdf", requireRole("admin"), (req, res) => {
  const campaignId = String(req.query.campaignId || "").trim();
  const month = Number(req.query.month || 0);
  const year = Number(req.query.year || new Date().getFullYear());
  const clauses = ["d.payment_status='Paid'"];
  const params = [];
  if (campaignId) { clauses.push("c.campaign_id=?"); params.push(Number(campaignId)); }
  if (month >= 1 && month <= 12) { clauses.push("CAST(strftime('%m', d.payment_date) AS INTEGER)=?"); params.push(month); }
  if (year >= 1900 && year <= 2200) { clauses.push("CAST(strftime('%Y', d.payment_date) AS INTEGER)=?"); params.push(year); }
  const rows = db.prepare(`SELECT d.payment_date,d.donor_name,d.amount,d.payment_method,d.payment_status,c.campaign_id,c.title AS campaign FROM donations d JOIN campaigns c ON c.campaign_id=d.campaign_id WHERE ${clauses.join(" AND ")} ORDER BY d.payment_date DESC`).all(...params);
  const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const campaign = campaignId ? db.prepare("SELECT title FROM campaigns WHERE campaign_id=?").get(Number(campaignId)) : null;
  const labelMonth = month ? new Date(year, month - 1, 1).toLocaleString("en-MY", { month: "long" }) : "All months";
  const lines = [
    "e-Waqf Management System - Donation Report",
    `Campaign: ${campaign ? campaign.title : "All campaigns"}`,
    `Period: ${labelMonth} ${year}`,
    `Generated: ${new Date().toLocaleString("en-MY")}`,
    "",
    `Transactions: ${rows.length}`,
    `Total donations: RM ${total.toFixed(2)}`,
    "",
    "DATE | CAMPAIGN | DONOR | AMOUNT (RM) | METHOD | STATUS",
    ...rows.map(r => `${r.payment_date} | ${r.campaign} | ${r.donor_name} | ${Number(r.amount).toFixed(2)} | ${r.payment_method} | ${r.payment_status}`),
    "",
    "This report includes paid donations matching the selected filters."
  ];
  const pdf = makeSimplePdf(lines);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="ewakaf-donation-report.pdf"');
  res.send(pdf);
});

app.get("/api/admin/notifications", requireRole("admin"), (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const campaigns = db.prepare("SELECT campaign_id,title,target_amount,current_amount,closing_date,status FROM campaigns WHERE status != 'Draft' ORDER BY closing_date ASC").all();
  const notifications = [];
  for (const c of campaigns) {
    if (Number(c.current_amount) >= Number(c.target_amount)) {
      notifications.push({ id: `goal-${c.campaign_id}`, campaign_id: c.campaign_id, title: c.title, type: "goal", message: "Donation goal reached", date: c.closing_date });
    }
    if (c.closing_date && c.closing_date.slice(0, 10) <= today) {
      notifications.push({ id: `deadline-${c.campaign_id}`, campaign_id: c.campaign_id, title: c.title, type: "deadline", message: "Campaign deadline reached", date: c.closing_date });
    }
  }
  res.json({ ok: true, notifications });
});

// Friendly page aliases.
const pageAliases = {
  "/": "/index.html", "/campaigns": "/campaigns.html", "/login": "/login.html",
  "/register": "/register.html", "/about": "/about.html", "/admin": "/admin-dashboard.html",
  "/admin/campaigns": "/admin-campaigns.html", "/admin/applications": "/admin-applications.html",
  "/admin/donations": "/admin-donations.html", "/admin/reports": "/admin-reports.html",
  "/aid/dashboard": "/aid-dashboard.html", "/aid/profile": "/aid-profile.html",
  "/aid/apply": "/aid-apply.html", "/aid/my-applications": "/my-applications.html"
};
for (const [route, file] of Object.entries(pageAliases)) {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, "public", file)));
}

app.use((req, res) => res.status(404).json({ ok: false, message: "The page or API endpoint you requested does not exist." }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err.message || "An unexpected server error occurred." });
});

app.listen(PORT, () => {
  console.log(`e-Wakaf Management System running at http://localhost:${PORT}`);
  console.log("Demo admin: admin / Admin@123");
  console.log("Demo applicant: applicant / Applicant@123");
  console.log("Admin signup code for new admin registration:", ADMIN_SIGNUP_CODE);
});
