const stripeService = require("../services/stripe.service");
const userRepository = require("../repositories/user.repository");

function isPremiumStatus(status) {
  return ["active", "trialing"].includes(String(status || "").toLowerCase());
}

async function createCheckout(req, res) {
  try {
    const user = await userRepository.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado."
      });
    }

    const session = await stripeService.createCheckoutSession({ user });

    return res.status(200).json({
      ok: true,
      data: {
        url: session.url
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao criar checkout."
    });
  }
}

async function createPortal(req, res) {
  try {
    const user = await userRepository.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado."
      });
    }

    if (!user.stripe_customer_id) {
      return res.status(400).json({
        ok: false,
        message: "Cliente Stripe ainda não vinculado."
      });
    }

    const session = await stripeService.createCustomerPortalSession({
      customerId: user.stripe_customer_id
    });

    return res.status(200).json({
      ok: true,
      data: {
        url: session.url
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao criar portal do cliente."
    });
  }
}

async function getBillingStatus(req, res) {
  try {
    const user = await userRepository.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado."
      });
    }

    const premium =
      user.role === "admin" ||
      String(user.plan || "").toLowerCase() === "premium";

    return res.status(200).json({
      ok: true,
      data: {
        plan: user.plan || "free",
        premium,
        subscriptionStatus: user.subscription_status || null,
        stripeCustomerId: user.stripe_customer_id || null,
        stripeSubscriptionId: user.stripe_subscription_id || null
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao buscar billing."
    });
  }
}

async function handleWebhook(req, res) {
  const signature = req.headers["stripe-signature"];

  let event;

  try {
    event = stripeService.constructWebhookEvent(req.body, signature);
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.mode === "subscription") {
          const userId = Number(
            session.client_reference_id || session.metadata?.userId
          );

          if (userId) {
            await userRepository.updateStripeCustomer(userId, {
              stripeCustomerId: session.customer || null,
              stripeSubscriptionId: session.subscription || null,
              subscriptionStatus: "active",
              plan: "premium"
            });
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const stripeCustomerId = subscription.customer;
        const status = subscription.status;
        const plan = isPremiumStatus(status) ? "premium" : "free";

        await userRepository.updateByStripeCustomerId(stripeCustomerId, {
          stripeSubscriptionId: subscription.id || null,
          subscriptionStatus: status || null,
          plan
        });
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao processar webhook."
    });
  }
}

module.exports = {
  createCheckout,
  createPortal,
  getBillingStatus,
  handleWebhook
};