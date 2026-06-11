import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Route for sending notifications
  app.post("/api/notify-shortage", async (req, res) => {
    const { tripNumber, originCenter, date, discrepancies, recipientEmail } = req.body;

    const smtpUser = process.env.GMAIL_USER;
    const smtpPass = process.env.GMAIL_PASS;

    if (!smtpUser || !smtpPass) {
      console.error("Missing GMAIL_USER or GMAIL_PASS environment variables");
      return res.status(500).json({ error: "Email configuration missing" });
    }

    // Gmail Configuration
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    // Create HTML table for discrepancies
    const tableRows = discrepancies
      .map(
        (d: any) => `
      <tr>
        <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${d.stageName}</td>
        <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${d.planned}</td>
        <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${d.actual}</td>
        <td style="border: 1px solid #ddd; padding: 8px; text-align: center; color: ${d.diff < 0 ? '#e11d48' : d.diff > 0 ? '#059669' : 'black'}; font-weight: bold;">
          ${d.diff > 0 ? '+' : ''}${d.diff}
        </td>
      </tr>
    `
      )
      .join("");

    const targetEmail = recipientEmail || process.env.RECIPIENT_EMAIL || "m0931700446@gmail.com";

    const mailOptions = {
      from: `"نظام تتبع الكتب" <${smtpUser}>`,
      to: targetEmail,
      subject: `🔔 تقرير فروقات الرحلة رقم: ${tripNumber}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #1e1b4b; text-align: center;">تقرير فروقات التنفيذ</h2>
          <p>تم رصد فروقات في تنفيذ الرحلة التالية:</p>
          <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <p><strong>رقم الرحلة:</strong> ${tripNumber}</p>
            <p><strong>المركز:</strong> ${originCenter}</p>
            <p><strong>التاريخ:</strong> ${date}</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background: #e2e8f0;">
                <th style="border: 1px solid #ddd; padding: 8px;">المرحلة</th>
                <th style="border: 1px solid #ddd; padding: 8px;">المخطط</th>
                <th style="border: 1px solid #ddd; padding: 8px;">المنفذ</th>
                <th style="border: 1px solid #ddd; padding: 8px;">الفرق</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
          <p style="margin-top: 25px; font-size: 11px; color: #64748b; text-align: center;">
            تم توليد هذا التقرير آلياً بواسطة نظام إدارة المخزون.
          </p>
        </div>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to send email:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
