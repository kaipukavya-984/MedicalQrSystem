const express = require('express');
const path = require('path');

const app = express();
const PORT = 8084;

// Serve static files (JS, CSS, images)
app.use(express.static(__dirname));

// Routes for HTML pages

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/generate', (req, res) => {
    res.sendFile(path.join(__dirname, 'generate.html'));
});

app.get('/scanner', (req, res) => {
    res.sendFile(path.join(__dirname, 'scanner.html'));
});

app.get('/patient', (req, res) => {
    res.sendFile(path.join(__dirname, 'patient.html'));
});

app.get('/access', (req, res) => {
    res.sendFile(path.join(__dirname, 'access.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});