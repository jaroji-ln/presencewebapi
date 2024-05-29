require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');


const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;

// CORS configuration
const corsOptions = {
  origin: 'http://localhost:3000/', // Update this to your frontend domain
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type,Authorization'
};

// Use CORS middleware
app.use(cors(corsOptions));

// Middleware to parse JSON
app.use(express.json());  // This is crucial to parse JSON request bodies

// Middleware to parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));


// Create MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

// Connect to the database
db.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL database');
});

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static('uploads'));

// Set up storage engine
const storage = multer.diskStorage({
  destination: './uploads/images/karyawan',
  filename: (req, file, cb) => {
    const randomName = crypto.randomBytes(16).toString('hex'); // Generate a random name
    const extension = path.extname(file.originalname);
    cb(null, `${Date.now()}-${randomName}${extension}`);
  }
});

// Init upload
const upload = multer({
  storage: storage,
  limits: { fileSize: 1000000 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb('Error: Images Only!');
    }
  }
}).single('picture');

//landing page
app.get('/', function(req, res){
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Register route
app.post('/register', async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err });
    }

    const { username, password, departemen, nik, nama } = req.body;
    const picture = req.file ? req.file.filename : null;

    if (!username || !password || !departemen || !nik || !nama) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    try {
      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user into the database
      const query = 'INSERT INTO karyawan (nik, nama, departemen, username, password, foto_profil) VALUES (?, ?, ?, ?, ?, ?)';
      db.query(query, [nik, nama, departemen, username, hashedPassword, picture], (err, results) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Username already exists' });
          }
          return res.status(500).json({ message: 'Database error', error: err });
        }
        res.status(201).json({ message: 'User registered successfully' });
      });
    } catch (error) {
      res.status(500).json({ message: 'Server error', error });
    }
  });
});

// Login route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log(JSON.stringify(req.body));
  // Find user in the database
  const query = 'SELECT * FROM karyawan WHERE username = ?';
  db.query(query, [username], async (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Database error', error: err });
    }

    if (results.length === 0) {
      return res.status(400).json({ message: 'Invalid username or password' });
    }

    const user = results[0];

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid username or password' });
    }

    // Generate JWT
    const tokens = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '3h' });

    res.json({ token: tokens, nama: user.nama, departemen: user.departemen, imgUrl: 'http://localhost:3000/uploads/images/karyawan/'+user.foto_profil });
  });
});

// Middleware to authenticate JWT
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.sendStatus(403);
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    res.sendStatus(403);
  }
};

// Endpoint to record entry presence
app.post('/entry', authenticateJWT, (req, res) => {
    const { nik, tanggal, jam_masuk, lokasi_masuk } = req.body;
  
    const query = 'INSERT INTO presensi (nik, tanggal, jam_masuk, lokasi_masuk, status) VALUES (?, ?, ?, ?, "H") ON DUPLICATE KEY UPDATE jam_masuk = ?, lokasi_masuk = ?, status = "H"';
    db.query(query, [nik, tanggal, jam_masuk, lokasi_masuk, jam_masuk, lokasi_masuk], (err, results) => {
      if (err) {
        return res.status(500).json({ message: 'Database error', error: err });
      }
      res.status(201).json({ message: 'Entry presence recorded successfully' });
    });
});
  
// Endpoint to record exit presence
app.post('/exit', authenticateJWT, (req, res) => {
    const { nik, tanggal, jam_keluar, lokasi_keluar } = req.body;
  
    const query = 'UPDATE presensi SET jam_keluar = ?, lokasi_keluar = ? WHERE nik = ? AND tanggal = ?';
    db.query(query, [jam_keluar, lokasi_keluar, nik, tanggal], (err, results) => {
      if (err) {
        return res.status(500).json({ message: 'Database error', error: err });
      }
      if (results.affectedRows === 0) {
        return res.status(400).json({ message: 'No entry record found for the given date and NIK' });
      }
      res.status(200).json({ message: 'Exit presence recorded successfully' });
    });
});
  
// Endpoint to get presence state
app.get('/presence', authenticateJWT, (req, res) => {
    const { nik, tanggal } = req.query;
  
    const query = 'SELECT * FROM presensi WHERE nik = ? AND tanggal = ?';
    db.query(query, [nik, tanggal], (err, results) => {
      if (err) {
        return res.status(500).json({ message: 'Database error', error: err });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: 'No presence record found for the given date and NIK' });
      }
      res.json(results[0]);
    });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});