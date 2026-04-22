function pad(value) {
  return String(value).padStart(2, "0");
}

function now() {
  return new Date();
}

function formatClock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatHourMinute(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000);
}

function getHour(date = new Date()) {
  return date.getHours();
}

function getSessionByHour(hour = 0) {
  if (hour >= 8 && hour <= 11) return "Londres";
  if (hour >= 14 && hour <= 17) return "Nova York";
  return "Ásia";
}

module.exports = {
  now,
  formatClock,
  formatHourMinute,
  addMinutes,
  getHour,
  getSessionByHour
};