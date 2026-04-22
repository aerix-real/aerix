const { createAuditLog } = require("../repositories/audit.repository");
const logger = require("../utils/logger");

async function registerAudit(eventType, description, meta = {}, userId = null) {
  try {
    return await createAuditLog({
      userId,
      eventType,
      description,
      meta
    });
  } catch (error) {
    logger.error("Falha ao registrar auditoria:", error);
    return null;
  }
}

module.exports = {
  registerAudit
};