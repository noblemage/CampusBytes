'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { getVendors, getMenuItems, placeOrder } from '@/app/actions/ordering';
import ActiveOrders from './ActiveOrders';

type View = 'vendors' | 'menu' | 'success';

interface Vendor {
  id: number;
  name: string;
}

interface MenuItem {
  id: number;
  name: string;
  price: number;
  isAvailable: boolean;
  imageUrl?: string | null;
}

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

export default function DailyMenuOrdering({ studentId, onBack }: { studentId: number; onBack: () => void }) {
  const [view, setView] = useState<View>('vendors');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [orderResult, setOrderResult] = useState<{ orderNumber: string; totalAmount: number } | null>(null);

  useEffect(() => {
    async function fetchVendors() {
      setIsLoading(true);
      const res = await getVendors();
      if (res.success && res.data) {
        setVendors(res.data);
      }
      setIsLoading(false);
    }
    fetchVendors();
  }, []);

  const handleSelectVendor = async (vendor: Vendor) => {
    setSelectedVendor(vendor);
    setCart([]);
    setIsLoading(true);
    setView('menu');
    const res = await getMenuItems(vendor.id);
    if (res.success && res.data) {
      setMenuItems(res.data);
    }
    setIsLoading(false);
  };

  const handleUpdateCart = (menuItem: MenuItem, delta: number) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.menuItem.id === menuItem.id);
      const currentQty = existing ? existing.quantity : 0;
      
      if (delta > 0 && currentQty >= 5) {
        toast.error(`Maximum 5 allowed for ${menuItem.name}`);
        return prev;
      }
      
      if (!existing) {
        if (delta > 0) return [...prev, { menuItem, quantity: delta }];
        return prev;
      }
      const newQuantity = existing.quantity + delta;
      if (newQuantity <= 0) {
        return prev.filter((item) => item.menuItem.id !== menuItem.id);
      }
      return prev.map((item) => (item.menuItem.id === menuItem.id ? { ...item, quantity: newQuantity } : item));
    });
  };

  const getQuantity = (menuItemId: number) => {
    return cart.find((item) => item.menuItem.id === menuItemId)?.quantity || 0;
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handlePlaceOrder = async () => {
    if (!selectedVendor || cart.length === 0) return;
    setIsLoading(true);
    
    const items = cart.map((c) => ({
      menuItemId: c.menuItem.id,
      quantity: c.quantity,
      price: c.menuItem.price
    }));

    const res = await placeOrder(studentId, selectedVendor.id, items);
    
    if (res.success && res.data) {
      setOrderResult({
        orderNumber: res.data.orderNumber,
        totalAmount: res.data.totalAmount
      });
      setView('success');
      setCart([]);
    } else {
      alert(res.error || 'Failed to place order');
    }
    setIsLoading(false);
  };

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in w-full relative pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          onClick={() => {
            if (view === 'success') {
              onBack();
            } else if (view === 'menu') {
              setView('vendors');
              setSelectedVendor(null);
            } else {
              onBack();
            }
          }}
          className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </button>
        <div>
          <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">
            {view === 'vendors' && 'Select Vendor'}
            {view === 'menu' && selectedVendor?.name}
            {view === 'success' && 'Order Confirmed'}
          </h2>
          <p className="text-xs text-zinc-400 font-medium mt-0.5">
            {view === 'vendors' && 'Choose where you want to order from.'}
            {view === 'menu' && 'Add items to your pre-order cart.'}
            {view === 'success' && 'Your order has been placed successfully.'}
          </p>
        </div>
      </div>

      {isLoading && view !== 'success' && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin"></div>
        </div>
      )}

      {/* View 1: Vendors */}
      {!isLoading && view === 'vendors' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {vendors.map((vendor) => (
            <button
              key={vendor.id}
              onClick={() => handleSelectVendor(vendor)}
              className="glass-card group relative p-4 sm:p-6 rounded-2xl text-left cursor-pointer transition-colors focus:outline-none overflow-hidden flex sm:block items-center gap-4 sm:gap-0"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 sm:mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-300">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
                </svg>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-zinc-100">{vendor.name}</h3>
            </button>
          ))}
          {vendors.length === 0 && (
            <p className="text-zinc-500 text-sm">No vendors available.</p>
          )}
        </div>
      )}

      {/* Live Orders (only shows when viewing vendors) */}
      {!isLoading && view === 'vendors' && (
        <div className="mt-8 pt-6 border-t border-zinc-800/50">
          <ActiveOrders studentId={studentId} />
        </div>
      )}

      {/* View 2: Menu */}
      {!isLoading && view === 'menu' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {menuItems.map((item) => (
            <div key={item.id} className="glass-card p-4 rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-zinc-100 font-bold">{item.name}</h4>
                <p className="text-zinc-400 text-sm">₹{item.price}</p>
              </div>
              
              <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
                <button 
                  onClick={() => handleUpdateCart(item, -1)}
                  className="w-8 h-8 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  disabled={getQuantity(item.id) === 0}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" /></svg>
                </button>
                <div className="w-6 shrink-0 flex items-center justify-center text-sm font-bold text-zinc-100">
                  {getQuantity(item.id)}
                </div>
                <button 
                  onClick={() => handleUpdateCart(item, 1)}
                  className="w-8 h-8 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  disabled={getQuantity(item.id) >= 5}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                </button>
              </div>
            </div>
          ))}
          {menuItems.length === 0 && (
            <p className="text-zinc-500 text-sm">No menu items available for this vendor.</p>
          )}
        </div>
      )}

      {/* View 3: Cart Overlay */}
      {view === 'menu' && cartItemCount > 0 && typeof document !== 'undefined' && createPortal(
        <div className="fixed bottom-6 left-0 right-0 px-4 md:px-0 flex justify-center z-[100] animate-fade-in pointer-events-none">
          <div className="w-full max-w-md bg-zinc-100 text-zinc-900 p-4 rounded-2xl shadow-2xl flex items-center justify-between pointer-events-auto">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Cart Total</p>
              <p className="text-lg font-bold">₹{cartTotal} <span className="text-sm font-medium text-zinc-600">({cartItemCount} items)</span></p>
            </div>
            <button
              onClick={handlePlaceOrder}
              disabled={isLoading}
              className="px-6 py-3 bg-zinc-200 text-zinc-900 hover:bg-white rounded-xl font-bold text-sm transition-colors shadow-md disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? 'Processing...' : 'Place Pre-Order'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* View 4: Success */}
      {view === 'success' && orderResult && (
        <div className="glass-card p-12 rounded-2xl flex flex-col items-center text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-emerald-950/40 border border-emerald-900 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-10 h-10 text-emerald-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-zinc-100">Order Placed!</h3>
            <p className="text-zinc-400 max-w-sm leading-relaxed">Present this booking number at <strong className="text-zinc-200">{selectedVendor?.name}</strong> to collect your order.</p>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 py-4 px-8 rounded-xl shadow-inner text-center">
            <p className="text-3xl font-mono font-bold text-white tracking-widest">{orderResult.orderNumber}</p>
          </div>
          <p className="text-zinc-400 font-medium">Total Paid: ₹{orderResult.totalAmount}</p>
          <button
            onClick={() => setView('vendors')}
            className="mt-4 px-8 py-4 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-200 text-sm font-bold rounded-xl transition-colors cursor-pointer w-full max-w-xs"
          >
            Back to Vendors
          </button>
        </div>
      )}
    </div>
  );
}
