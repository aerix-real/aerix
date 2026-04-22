const bcrypt = require("bcrypt");
const env = require("../config/env");

async function hashPassword(password) {
  return bcrypt.hash(password, env.auth.bcryptSaltRounds);
}

async function comparePassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  hashPassword,
  comparePassword
};