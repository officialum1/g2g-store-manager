const express = require("express");
const path = require("path");

const router = express.Router();
const dashboardDirectory = path.join(__dirname, "..", "dashboard");

router.get("/", (req, res) => {
  return res.sendFile(path.join(dashboardDirectory, "index.html"));
});

router.use(express.static(dashboardDirectory, { index: false }));

module.exports = router;
