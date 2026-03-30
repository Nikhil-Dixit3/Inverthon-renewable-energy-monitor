const mongoose = require("mongoose");

// Each document represents one reading collected from the energy monitoring node.
const energySchema = new mongoose.Schema(
  {
    voltage: {
      type: Number,
      required: true,
      min: 0
    },
    current: {
      type: Number,
      required: true,
      min: 0
    },
    power: {
      type: Number,
      required: true,
      min: 0
    },
    temperature: {
      type: Number,
      required: true
    },
    inputPower: {
      type: Number,
      default: null,
      min: 0
    },
    source: {
      type: String,
      default: "ESP32",
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    versionKey: false
  }
);

module.exports = mongoose.model("Energy", energySchema);
