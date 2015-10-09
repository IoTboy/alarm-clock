"use strict";

// get an API key at http://www.wunderground.com/weather/api/
var API_KEY = process.env.WEATHER_API_KEY;

var buzzer = new (require("jsupm_buzzer").Buzzer)(5),
    button = new (require("jsupm_grove").GroveButton)(4),
    rotary = new (require("jsupm_grove").GroveRotary)(0),
    screen = new (require("jsupm_i2clcd").Jhd1313m1)(6, 0x3E, 0x62);

var moment = require("moment"),
    request = require("superagent");

var fs = require("fs"),
    path = require("path");

var events = new (require("events").EventEmitter)();

var colors = { red: [255, 0, 0], white: [255, 255, 255] },
    current,
    alarm;

function color(string) {
  screen.setColor.apply(screen, colors[string] || colors.white);
}

function message(string, line) {
  // pad string to avoid display issues
  while (string.length < 16) { string += " "; }

  screen.setCursor(line || 0, 0);
  screen.write(string);
}

function buzz() {
  buzzer.setVolume(0.5);
  buzzer.playSound(2600, 0);
}

function stopBuzzing() {
  buzzer.stopSound();
  buzzer.stopSound(); // if called only once, buzzer doesn't completely stop
}

function setupEvents() {
  var prev = { button: 0 };

  setInterval(function() {
    var pressed = button.value();

    events.emit("rotary", rotary.abs_value());

    if (pressed && !prev.button) { events.emit("button-press"); }
    if (!pressed && prev.button) { events.emit("button-release"); }

    prev.button = pressed;
  }, 100);
}

function getWeather() {
  var url = "http://api.wunderground.com/api/";

  url += API_KEY;
  url += "/conditions/q/CA/San_Francisco.json";

  function display(err, res) {
    if (err) { return console.error("unable to get weather data", res.text); }
    var conditions = res.body.current_observation.weather;
    console.log("forecast:", conditions);
    message(conditions, 1);
  }

  request.get(url).end(display);
}

function notifyServer(duration) {
  if (!process.env.SERVER || !process.env.AUTH_TOKEN) {
    return;
  }
  
  function callback(err, res) {
    if (err) { return console.error("err:", res.text); }
  }

  request
    .put(process.env.SERVER)
    .set("X-Auth-Token", process.env.AUTH_TOKEN)
    .send({ value: duration })
    .end(callback);
}

function startAlarm() {
  var tick = true;

  color("red");
  buzz();
  getWeather();

  var interval = setInterval(function() {
    color(tick ? "white" : "red");
    if (tick) { stopBuzzing(); } else { buzz(); }
    tick = !tick;
  }, 250);

  events.once("button-press", function() {
    clearInterval(interval);

    // let server now how long alarm took to be silenced
    notifyServer(moment().diff(alarm).toString());

    alarm = alarm.add(1, "day");

    color("white");
    stopBuzzing();
  });
}

function startClock() {
  function after(a, b) { return a.isAfter(b, "second"); }
  function same(a, b) { return a.isSame(b, "second"); }

  setInterval(function() {
    var time = moment();

    // check if display needs to be updated
    if (after(time, current)) {
      message(time.format("h:mm:ss A"));
      if (same(current, alarm)) { startAlarm(); }
    }

    current = time;
  }, 50);
}

function adjustBrightness(value) {
  var start = 0,
      end = 1020,
      val = Math.floor(((value - start) / end) * 255);

  if (val > 255) { val = 255; }
  if (val < 0) { val = 0; }

  screen.setColor(val, val, val);
}

function server() {
  var app = require("express")();

  function index(res) {
    function serve(err, data) {
      if (err) { return console.error(err); }
      res.send(data);
    }
    fs.readFile(path.join(__dirname, "index.html"), {encoding: "utf-8"}, serve);
  }

  function get(req, res) {
    var params = req.query,
        time = moment();

    time.hour(+params.hour);
    time.minute(+params.minute);
    time.second(+params.second);

    if (time.isBefore(moment())) {
      time.add(1, "day");
    }

    alarm = time;

    index(res);
  }

  function json(req, res) {
    if (!alarm) { return res.json({ hour: 0, minute: 0, second: 0 }); }

    res.json({
      hour: alarm.hour() || 0,
      minute: alarm.minute() || 0,
      second: alarm.second() || 0
    });
  }

  app.get("/", get);
  app.get("/alarm.json", json);

  app.listen(3000);
}

function main() {
  stopBuzzing();
  setupEvents();
  startClock();
  server();

  events.on("rotary", adjustBrightness);
}

main();
