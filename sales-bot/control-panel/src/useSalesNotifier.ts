import { useEffect, useRef } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { api } from "./api";

const POLL_MS = 15000;

// Следит за журналом продаж независимо от того, какая вкладка сейчас
// открыта, и показывает нативный тост Windows при появлении новой продажи.
// Первый опрос только запоминает текущее количество — не шлёт уведомления
// о продажах, случившихся до запуска панели.
export function useSalesNotifier() {
  const lastCountRef = useRef<number | null>(null);

  useEffect(() => {
    async function poll() {
      let sales;
      try {
        sales = await api.getSales();
      } catch {
        return;
      }

      if (lastCountRef.current === null) {
        lastCountRef.current = sales.length;
        return;
      }

      const newCount = sales.length - lastCountRef.current;
      lastCountRef.current = sales.length;
      if (newCount <= 0) return;

      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) return;

      // sales идёт новыми-сверху — новые записи это первые newCount штук.
      const newest = sales.slice(0, newCount).reverse();
      for (const sale of newest) {
        const buyer = sale.username ? `@${sale.username}` : sale.userId;
        sendNotification({ title: "Новая продажа", body: `${sale.stars} Stars от ${buyer}` });
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, []);
}
