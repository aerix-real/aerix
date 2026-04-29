const Stripe = require("stripe");
const db = require("../config/database");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function createCheckoutSession(user) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",

    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }
    ],

    success_url: `${process.env.APP_URL}/?success=true`,
    cancel_url: `${process.env.APP_URL}/?canceled=true`,

    customer_email: user.email,

    metadata: {
      userId: user.id
    }
  });

  return session;
}

async function handleWebhookEvent(event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const userId = session.metadata.userId;

    await db.query(
      `UPDATE users SET plan = 'premium' WHERE id = $1`,
      [userId]
    );

    console.log("🔥 Usuário virou PREMIUM:", userId);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;

    const customerEmail = subscription.customer_email;

    await db.query(
      `UPDATE users SET plan = 'free' WHERE email = $1`,
      [customerEmail]
    );

    console.log("⚠️ Usuário voltou para FREE:", customerEmail);
  }
}

module.exports = {
  createCheckoutSession,
  handleWebhookEvent
};