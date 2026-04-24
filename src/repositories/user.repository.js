const db = require("../config/database");

async function findById(id) {
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
      created_at
    FROM users
    WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function findByEmail(email) {
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
      created_at
    FROM users
    WHERE email = $1
    `,
    [email]
  );

  return result.rows[0] || null;
}

async function listAll() {
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
      created_at
    FROM users
    ORDER BY id ASC
    `
  );

  return result.rows;
}

async function updateProfile(id, { name, email }) {
  const result = await db.query(
    `
    UPDATE users
    SET
      name = $2,
      email = $3
    WHERE id = $1
    RETURNING
      id,
      name,
      email,
      role,
      plan,
      stripe_customer_id,
      stripe_subscription_id,
      subscription_status,
      created_at
    `,
    [id, name, email]
  );

  return result.rows[0] || null;
}

async function updateRole(id, role) {
  const result = await db.query(
    `
    UPDATE users
    SET role = $2
    WHERE id = $1
    RETURNING
      id,
      name,
      email,
      role,
      plan,
      stripe_customer_id,
      stripe_subscription_id,
      subscription_status,
      created_at
    `,
    [id, role]
  );

  return result.rows[0] || null;
}

async function updatePlan(id, plan) {
  const result = await db.query(
    `
    UPDATE users
    SET plan = $2
    WHERE id = $1
    RETURNING
      id,
      name,
      email,
      role,
      plan,
      stripe_customer_id,
      stripe_subscription_id,
      subscription_status,
      created_at
    `,
    [id, plan]
  );

  return result.rows[0] || null;
}

async function updateStripeCustomer(
  id,
  { stripeCustomerId, stripeSubscriptionId, subscriptionStatus, plan }
) {
  const result = await db.query(
    `
    UPDATE users
    SET
      stripe_customer_id = COALESCE($2, stripe_customer_id),
      stripe_subscription_id = COALESCE($3, stripe_subscription_id),
      subscription_status = COALESCE($4, subscription_status),
      plan = COALESCE($5, plan)
    WHERE id = $1
    RETURNING
      id,
      name,
      email,
      role,
      plan,
      stripe_customer_id,
      stripe_subscription_id,
      subscription_status,
      created_at
    `,
    [id, stripeCustomerId, stripeSubscriptionId, subscriptionStatus, plan]
  );

  return result.rows[0] || null;
}

async function updateByStripeCustomerId(
  stripeCustomerId,
  { stripeSubscriptionId, subscriptionStatus, plan }
) {
  const result = await db.query(
    `
    UPDATE users
    SET
      stripe_subscription_id = COALESCE($2, stripe_subscription_id),
      subscription_status = COALESCE($3, subscription_status),
      plan = COALESCE($4, plan)
    WHERE stripe_customer_id = $1
    RETURNING
      id,
      name,
      email,
      role,
      plan,
      stripe_customer_id,
      stripe_subscription_id,
      subscription_status,
      created_at
    `,
    [stripeCustomerId, stripeSubscriptionId, subscriptionStatus, plan]
  );

  return result.rows[0] || null;
}

module.exports = {
  findById,
  findByEmail,
  listAll,
  updateProfile,
  updateRole,
  updatePlan,
  updateStripeCustomer,
  updateByStripeCustomerId
};