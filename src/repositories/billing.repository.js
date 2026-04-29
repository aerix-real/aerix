const db = require("../config/database");

class BillingRepository {
  async activatePremiumByUserId(userId, payload = {}) {
    const result = await db.query(
      `
      UPDATE users
      SET 
        plan = 'PREMIUM',
        stripe_customer_id = COALESCE($2, stripe_customer_id),
        stripe_subscription_id = COALESCE($3, stripe_subscription_id),
        subscription_status = COALESCE($4, 'active'),
        premium_until = COALESCE($5, premium_until)
      WHERE id = $1
      RETURNING id, name, email, role, plan, stripe_customer_id, stripe_subscription_id, subscription_status, premium_until
      `,
      [
        userId,
        payload.customerId || null,
        payload.subscriptionId || null,
        payload.subscriptionStatus || "active",
        payload.premiumUntil || null
      ]
    );

    return result.rows[0] || null;
  }

  async downgradeBySubscriptionId(subscriptionId) {
    const result = await db.query(
      `
      UPDATE users
      SET 
        plan = 'FREE',
        subscription_status = 'inactive'
      WHERE stripe_subscription_id = $1
      RETURNING id, name, email, role, plan, stripe_customer_id, stripe_subscription_id, subscription_status, premium_until
      `,
      [subscriptionId]
    );

    return result.rows[0] || null;
  }

  async downgradeByCustomerId(customerId) {
    const result = await db.query(
      `
      UPDATE users
      SET 
        plan = 'FREE',
        subscription_status = 'inactive'
      WHERE stripe_customer_id = $1
      RETURNING id, name, email, role, plan, stripe_customer_id, stripe_subscription_id, subscription_status, premium_until
      `,
      [customerId]
    );

    return result.rows[0] || null;
  }

  async getBillingStatus(userId) {
    const result = await db.query(
      `
      SELECT 
        id,
        name,
        email,
        role,
        plan,
        stripe_customer_id,
        stripe_subscription_id,
        subscription_status,
        premium_until
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    return result.rows[0] || null;
  }
}

module.exports = new BillingRepository();