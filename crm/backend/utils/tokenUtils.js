const jwt = require('jsonwebtoken')

function signAccess(payload) {
  const ttl = process.env.JWT_ACCESS_EXPIRES || process.env.ACCESS_TOKEN_TTL || '15m'
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: ttl })
}

function signRefresh(payload) {
  const ttl = process.env.JWT_REFRESH_EXPIRES || process.env.REFRESH_TOKEN_TTL || '7d'
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: ttl })
}

function verifyAccess(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET)
}

function verifyRefresh(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET)
}

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh, setRefreshCookie }
