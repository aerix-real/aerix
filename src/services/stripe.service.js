const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getAppUrl() {
  return process.env.APP_URL || "http://localhost:3000";
}

async function createCheckoutSession({ user }) {
  const appUrl = getAppUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    success_url: `${appUrl}/?checkout=success`,
    cancel_url: `${appUrl}/?checkout=cancel`,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
        quantity: 1
      }
    ],
    client_reference_id: String(user.id),
    customer_email: user.email,
    metadata: {
      userId: String(user.id),
      plan: "premium"
    }
  });

  return session;
}

async function createCustomerPortalSession({ customerId }) {
  const appUrl = getAppUrl();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/`
  });

  return session;
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

async function retrieveSubscription(subscriptionId) {
  return stripe.subscriptions.retrieve(subscriptionId);
}

module.exports = {
  stripe,
  createCheckoutSession,
  createCustomerPortalSession,
  constructWebhookEvent,
  retrieveSubscription
};