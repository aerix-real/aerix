const jwt = require("jsonwebtoken");
const env = require("../config/env");

function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan
    },
    env.auth.jwtSecret,
    {
      expiresIn: env.auth.jwtExpiresIn
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.auth.jwtSecret);
}

module.exports = {
  generateAccessToken,
  verifyAccessToken
};