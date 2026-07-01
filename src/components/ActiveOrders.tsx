'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

interface OrderItem {
  id: number;
  quantity: number;
  menuItem: { name: string };
}

interface ActiveOrder {
  id: number;
  orderNumber: string;
  vendor: { name: string };
  totalAmount: number;
  status: string;
  createdAt: string;
  items: OrderItem[];
}

export default function ActiveOrders({ studentId }: { studentId: number }) {
  const [orders, setOrders] = useState<ActiveOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const prevOrdersRef = useRef<ActiveOrder[]>([]);

  const fetchOrders = useCallback(async () => {
    // Initial fetch so it doesn't wait 10s for the first event
    try {
      const res = await fetch(`/api/students/orders?id=${studentId}`);
      if (!res.ok) return;
      const data = await res.json();
      handleNewOrders(data.activeOrders || []);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, [studentId]);

  const handleNewOrders = useCallback((newOrders: ActiveOrder[]) => {
    const prevOrders = prevOrdersRef.current;
    if (prevOrders.length > 0) {
      for (const order of newOrders) {
        const prev = prevOrders.find((o) => o.id === order.id);
        if (prev && prev.status === 'Pending' && order.status === 'Ready') {
          toast.success(`🎉 Order ${order.orderNumber} is ready for pickup!`, {
            duration: 8000,
          });
        }
      }
    }

    prevOrdersRef.current = newOrders;
    setOrders(newOrders);
  }, []);

  useEffect(() => {
    fetchOrders();

    const eventSource = new EventSource(`/api/students/orders/sse?id=${studentId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.activeOrders) {
          handleNewOrders(data.activeOrders);
          setIsLoading(false);
        }
      } catch (err) {}
    };

    return () => {
      eventSource.close();
    };
  }, [studentId, fetchOrders, handleNewOrders]);

  if (isLoading || orders.length === 0) return null;

  const pendingOrders = orders.filter((o) => o.status === 'Pending');
  const readyOrders = orders.filter((o) => o.status === 'Ready');

  return (
    <div className="space-y-3 animate-fade-in w-full">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Live Orders</h3>
        <span className="text-xs text-zinc-500 ml-auto font-medium">Auto-refreshing</span>
      </div>

      {/* Scrollable container — shows max 2 orders at a time */}
      <div className="max-h-[280px] overflow-y-auto space-y-3 pr-1">
        {readyOrders.map((order) => (
          <div
            key={order.id}
            className="glass-card p-4 rounded-xl border-zinc-800 animate-fade-in"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 text-zinc-300">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-100">{order.orderNumber}</p>
                <p className="text-xs text-zinc-400">{order.vendor.name}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider bg-emerald-950/40 text-emerald-400 border border-emerald-900">
                Ready
              </span>
            </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {order.items.map((item) => (
                <span key={item.id} className="text-xs text-zinc-300 bg-zinc-800/80 px-2 py-1 rounded-md">
                  {item.quantity}x {item.menuItem.name}
                </span>
              ))}
            </div>
            <p className="text-xs text-zinc-400 font-bold mt-3">Pick up your order now.</p>
          </div>
        ))}

        {pendingOrders.map((order) => (
          <div
            key={order.id}
            className="glass-card p-4 rounded-xl border border-zinc-800 animate-fade-in"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 text-zinc-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-100">{order.orderNumber}</p>
                <p className="text-xs text-zinc-400">{order.vendor.name}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider bg-zinc-900 text-zinc-500 border border-zinc-800">
                Preparing
              </span>
            </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {order.items.map((item) => (
                <span key={item.id} className="text-xs text-zinc-300 bg-zinc-800/80 px-2 py-1 rounded-md">
                  {item.quantity}x {item.menuItem.name}
                </span>
              ))}
            </div>
            <p className="text-xs text-zinc-500 font-medium mt-3">
              ₹{order.totalAmount} · Placed {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>

      {orders.length > 2 && (
        <p className="text-xs text-zinc-500 text-center font-medium">Scroll to see more orders</p>
      )}
    </div>
  );
}
