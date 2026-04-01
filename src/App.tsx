import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, 
  Link as LinkIcon, 
  Image as ImageIcon, 
  Upload, 
  Plus, 
  Check, 
  AlertCircle, 
  Loader2, 
  Trash2, 
  MapPin,
  Clock,
  DollarSign,
  CalendarDays,
  Type,
  ArrowLeft,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';
import { extractEventFromImage, extractEventFromUrl, extractEventFromText, type ExtractedEvent } from './lib/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_CALENDAR_ID = 'be9e960ac872cd4c1d48b086283211e629ac4bb9d07305fc8b6629b25f3eea55@group.calendar.google.com';

export default function App() {
  const getErrorMessage = (error: any): string => {
    if (!error) return "Unknown error";
    
    let errorObj = error;
    
    // If it's a string that looks like JSON, parse it
    if (typeof error === 'string' && error.trim().startsWith('{')) {
      try {
        errorObj = JSON.parse(error);
      } catch {
        return error;
      }
    }

    // Handle Gemini/Google API error structures
    // Case 1: { error: { message: "...", ... } }
    if (errorObj?.error?.message) {
      return errorObj.error.message;
    }
    
    // Case 2: { message: "...", ... }
    if (errorObj?.message) {
      // If the message itself is a JSON string (common in some SDKs)
      if (typeof errorObj.message === 'string' && errorObj.message.trim().startsWith('{')) {
        try {
          const inner = JSON.parse(errorObj.message);
          if (inner?.error?.message) return inner.error.message;
          if (inner?.message) return inner.message;
        } catch {}
      }
      return errorObj.message;
    }

    // Case 3: { error: "..." }
    if (errorObj?.error && typeof errorObj.error === 'string') {
      return errorObj.error;
    }

    // Fallback: stringify if object, otherwise string
    const final = typeof errorObj === 'object' ? JSON.stringify(errorObj) : String(errorObj);
    
    // If it's still a JSON string after all this, it might be double-encoded or we missed a level
    if (final.startsWith('{')) {
       try {
         const lastTry = JSON.parse(final);
         if (lastTry?.error?.message) return lastTry.error.message;
         if (lastTry?.message) return lastTry.message;
       } catch {}
    }

    return final;
  };

  const [currentView, setCurrentView] = useState<'source' | 'review'>('source');
  const [url, setUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedEvents, setExtractedEvents] = useState<ExtractedEvent[]>([]);
  const [tokens, setTokens] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ index: number | 'all'; success: boolean; message: string } | null>(null);
  const [notification, setNotification] = useState<{ 
    type: 'error' | 'success' | 'info'; 
    message: string; 
    details?: string;
    showDetails?: boolean;
  } | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [manualEvent, setManualEvent] = useState<ExtractedEvent>({
    name: '',
    venue: '',
    address: '',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    startTime: '',
    endDate: '',
    endTime: '',
    price: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onGeminiRetry = (attempt: number, delay: number) => {
    setNotification({ 
      type: 'info', 
      message: `AI is busy (Attempt ${attempt}/3). Retrying in ${delay/1000}s...` 
    });
  };

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (!file) continue;

          setIsExtracting(true);
          setNotification({ type: 'info', message: 'Analyzing pasted image...' });
          
          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]);
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });

            const events = await extractEventFromImage(base64, onGeminiRetry);
            if (events.length > 0) {
              setExtractedEvents(prev => [...prev, ...events]);
              setNotification({ type: 'success', message: `${events.length} event(s) extracted from image!` });
              setCurrentView('review');
            } else {
              setNotification({ type: 'info', message: 'No Munich-related events found in this image.' });
            }
          } catch (error: any) {
            console.error("Paste extraction error:", error);
            const detail = error?.message || (typeof error === 'string' ? error : JSON.stringify(error));
            setNotification({ 
              type: 'error', 
              message: 'Failed to analyze pasted image.',
              details: detail
            });
          } finally {
            setIsExtracting(false);
          }
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setTokens(event.data.tokens);
        localStorage.setItem('google_tokens', JSON.stringify(event.data.tokens));
      }
    };
    window.addEventListener('message', handleMessage);
    
    const storedTokens = localStorage.getItem('google_tokens');
    if (storedTokens) {
      try {
        setTokens(JSON.parse(storedTokens));
      } catch (e) {
        console.error("Failed to parse stored tokens", e);
      }
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleClipboardPaste = async () => {
    try {
      // Check if the Clipboard API is available and not blocked
      if (!navigator.clipboard || !navigator.clipboard.read) {
        throw new Error("Clipboard API not supported in this browser or context.");
      }

      const items = await navigator.clipboard.read();
      let foundImage = false;
      
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const file = new File([blob], "pasted-image.png", { type });
            
            setIsExtracting(true);
            setNotification({ type: 'info', message: 'Analyzing clipboard image...' });
            
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]);
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });

            const events = await extractEventFromImage(base64, onGeminiRetry);
            if (events.length > 0) {
              setExtractedEvents(prev => [...prev, ...events]);
              setNotification({ type: 'success', message: `${events.length} event(s) extracted from clipboard!` });
              setCurrentView('review');
            } else {
              setNotification({ type: 'info', message: 'No Munich-related events found in clipboard.' });
            }
            foundImage = true;
            break;
          }
        }
        if (foundImage) break;
      }
      
      if (!foundImage) {
        setNotification({ type: 'error', message: 'No image found in clipboard.' });
      }
    } catch (err: any) {
      console.error("Clipboard error:", err);
      const isPermissionError = err?.name === 'NotAllowedError' || err?.message?.includes('permissions policy');
      
      setNotification({ 
        type: 'error', 
        message: isPermissionError 
          ? 'Clipboard access blocked by browser security. Please use Ctrl+V (or Cmd+V) directly on the page instead!'
          : 'Clipboard access denied or not supported.',
        details: err?.message || String(err)
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingIndex !== null) {
      const newEvents = [...extractedEvents];
      newEvents[editingIndex] = manualEvent;
      setExtractedEvents(newEvents);
      setNotification({ type: 'success', message: 'Event updated!' });
    } else {
      setExtractedEvents(prev => [...prev, manualEvent]);
      setNotification({ type: 'success', message: 'Event added manually!' });
      setCurrentView('review');
    }
    closeManualForm();
  };

  const closeManualForm = () => {
    setShowManualForm(false);
    setEditingIndex(null);
    setManualEvent({
      name: '',
      venue: '',
      address: '',
      startDate: format(new Date(), 'yyyy-MM-dd'),
      startTime: '',
      endDate: '',
      endTime: '',
      price: '',
    });
  };

  const startEditing = (index: number, event: ExtractedEvent) => {
    setEditingIndex(index);
    setManualEvent({ ...event });
    setShowManualForm(true);
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    setIsExtracting(true);
    setNotification(null);
    try {
      const events = await extractEventFromUrl(url, onGeminiRetry);
      if (events.length > 0) {
        setExtractedEvents(prev => [...prev, ...events]);
        setUrl('');
        setNotification({ type: 'success', message: `${events.length} event(s) extracted successfully!` });
        setCurrentView('review');
      } else {
        setNotification({ type: 'info', message: 'No Munich-related events found at this URL.' });
      }
    } catch (error: any) {
      console.error("Extraction error:", error);
      let message = "Failed to extract event from URL.";
      if (url.includes('instagram.com')) {
        message = "Instagram links can be tricky. If this fails, try taking a screenshot and uploading it!";
      }
      setNotification({ 
        type: 'error', 
        message,
        details: getErrorMessage(error)
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleTextExtract = async () => {
    if (!rawText.trim()) return;
    
    setIsExtracting(true);
    setNotification(null);
    try {
      const events = await extractEventFromText(rawText, onGeminiRetry);
      if (events.length > 0) {
        setExtractedEvents(prev => [...prev, ...events]);
        setRawText('');
        setNotification({ type: 'success', message: `${events.length} event(s) extracted from text!` });
        setCurrentView('review');
      } else {
        setNotification({ type: 'info', message: 'No Munich-related events found in the text.' });
      }
    } catch (error: any) {
      console.error("Text extraction error:", error);
      setNotification({ 
        type: 'error', 
        message: 'Failed to extract event from text.',
        details: getErrorMessage(error)
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setNotification(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const events = await extractEventFromImage(base64, onGeminiRetry);
      if (events.length > 0) {
        setExtractedEvents(prev => [...prev, ...events]);
        setNotification({ type: 'success', message: `${events.length} event(s) extracted from image!` });
        setCurrentView('review');
      } else {
        setNotification({ type: 'info', message: 'No Munich-related events found in this image.' });
      }
    } catch (error: any) {
      console.error("Extraction error:", error);
      setNotification({ 
        type: 'error', 
        message: `Failed to analyze image.`,
        details: getErrorMessage(error)
      });
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConnect = async () => {
    try {
      const response = await fetch('/api/auth/url');
      const { url } = await response.json();
      window.open(url, 'oauth_popup', 'width=600,height=700');
    } catch (error) {
      console.error("Auth error:", error);
    }
  };

  const handleSync = async (event: ExtractedEvent, index: number) => {
    if (!tokens) {
      handleConnect();
      return;
    }

    setIsSyncing(true);
    setSyncStatus(null);
    
    try {
      // Prepare ISO dates or all-day flag
      const isAllDay = !event.startTime;
      let startDateTime: string | undefined;
      let endDateTime: string | undefined;

      if (!isAllDay) {
        // Create date object from local time string (no 'Z')
        // This interprets the time in the user's local timezone
        const start = new Date(`${event.startDate}T${event.startTime}:00`);
        if (isNaN(start.getTime())) {
          throw new Error("Invalid date or time format");
        }
        startDateTime = start.toISOString();
        
        if (event.endDate && event.endTime) {
          const end = new Date(`${event.endDate}T${event.endTime}:00`);
          endDateTime = end.toISOString();
        } else {
          // Default 1 hour duration
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          endDateTime = end.toISOString();
        }
      }

      const response = await fetch('/api/calendar/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          event: { ...event, startDateTime, endDateTime, isAllDay }, 
          tokens,
          calendarId: DEFAULT_CALENDAR_ID
        }),
      });

      const result = await response.json();
      if (result.success) {
        // Only show individual sync status if not part of "Sync All"
        if (index !== -1) {
          setSyncStatus({ index, success: true, message: "Event added!" });
          setTimeout(() => {
            setExtractedEvents(prev => prev.filter((_, i) => i !== index));
            setSyncStatus(null);
          }, 1500);
        }
        return true;
      } else {
        const errorStr = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
        if (errorStr.includes("invalid_request") || errorStr.includes("Not authenticated")) {
          setNotification({ 
            type: 'error', 
            message: "Session expired or invalid. Please re-connect your calendar.",
            details: getErrorMessage(result.error)
          });
          setTokens(null);
          localStorage.removeItem('google_tokens');
        } else {
          setNotification({ 
            type: 'error', 
            message: "Failed to sync event.",
            details: getErrorMessage(result.error)
          });
        }
        return false;
      }
    } catch (error) {
      console.error("Sync error:", error);
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    if (!tokens) {
      handleConnect();
      return;
    }

    setIsSyncing(true);
    setSyncStatus(null);
    setNotification({ type: 'info', message: 'Syncing all events...' });

    const eventsToSync = [...extractedEvents];
    let successCount = 0;
    let hasError = false;

    for (let i = 0; i < eventsToSync.length; i++) {
      // Pass -1 to handleSync to indicate it's part of a bulk operation (no individual overlays)
      const success = await handleSync(eventsToSync[i], -1);
      if (success) {
        successCount++;
      } else {
        hasError = true;
        break;
      }
    }

    if (successCount > 0) {
      // Clear the list of successfully synced events
      setExtractedEvents(prev => prev.slice(successCount));
      setNotification({ 
        type: 'success', 
        message: hasError 
          ? `Synced ${successCount} events, but encountered an error.` 
          : `Successfully synced all ${successCount} events!` 
      });
    }

    setIsSyncing(false);
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans selection:bg-[#FF6321] selection:text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#1A1A1A]/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-[#FF6321] rounded-xl flex items-center justify-center text-white shadow-lg shadow-[#FF6321]/20">
              <Calendar className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tighter hidden sm:block">MunichEvents<span className="text-[#FF6321]">.ai</span></h1>
          </div>

          <div className="flex items-center gap-4">
            <a 
              href="https://calendar.google.com/calendar/u/0/embed?src=be9e960ac872cd4c1d48b086283211e629ac4bb9d07305fc8b6629b25f3eea55@group.calendar.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-gray-100 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="hidden md:inline">Open Calendar</span>
            </a>

            <AnimatePresence>
              {notification && (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className={cn(
                    "hidden lg:flex items-center gap-3 px-4 py-2 rounded-full text-xs font-bold border shadow-sm",
                    notification.type === 'error' ? "bg-red-50 border-red-100 text-red-600" : 
                    notification.type === 'success' ? "bg-green-50 border-green-100 text-green-600" :
                    "bg-blue-50 border-blue-100 text-blue-600"
                  )}
                >
                  {notification.type === 'error' ? <AlertCircle className="w-4 h-4" /> : 
                   notification.type === 'success' ? <Check className="w-4 h-4" /> : 
                   <Loader2 className="w-4 h-4 animate-spin" />}
                  {notification.message}
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              onClick={handleConnect}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all duration-300",
                tokens 
                  ? "bg-green-50 text-green-700 border border-green-200" 
                  : "bg-[#FF6321] text-white hover:bg-[#E55A1E] active:scale-95 shadow-lg shadow-[#FF6321]/20"
              )}
            >
              {tokens ? <Check className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
              {tokens ? "Connected" : "Connect Calendar"}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "md:hidden fixed top-24 left-6 right-6 z-[60] p-4 rounded-2xl text-sm font-bold shadow-xl border flex flex-col gap-2",
              notification.type === 'error' ? "bg-red-500 text-white border-red-600" : 
              notification.type === 'success' ? "bg-green-500 text-white border-green-600" :
              "bg-blue-500 text-white border-blue-600"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {notification.type === 'error' ? <AlertCircle className="w-5 h-5" /> : 
                 notification.type === 'success' ? <Check className="w-5 h-5" /> : 
                 <Loader2 className="w-5 h-5 animate-spin" />}
                {notification.message}
              </div>
              <button onClick={() => setNotification(null)}>×</button>
            </div>

            {notification.details && (
              <div className="mt-1">
                <button 
                  onClick={() => setNotification(prev => prev ? { ...prev, showDetails: !prev.showDetails } : null)}
                  className="text-[10px] underline opacity-80"
                >
                  {notification.showDetails ? "Hide Details" : "Show Details"}
                </button>
                {notification.showDetails && (
                  <pre className="mt-2 p-2 bg-black/20 rounded-lg overflow-x-auto font-mono text-[9px] whitespace-pre-wrap break-all">
                    {notification.details}
                  </pre>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-4xl mx-auto px-6 py-12 md:py-20">
        <AnimatePresence mode="wait">
          {currentView === 'source' ? (
            <motion.div
              key="source"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {/* Hero Section */}
              <div className="text-center mb-16">
                <h2 className="text-5xl md:text-7xl font-light tracking-tighter mb-6 leading-[0.9]">
                  Turn any event info into a <span className="italic font-serif text-[#FF6321]">calendar entry</span>.
                </h2>
                <p className="text-lg text-[#1A1A1A]/60 max-w-xl mx-auto">
                  Paste a link or upload a screenshot. Our AI extracts the details and syncs them instantly.
                </p>
              </div>

              {/* Input Section */}
              <div className="relative">
                {!tokens && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-[4px] rounded-[3rem] -m-4 p-4">
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="bg-white border border-[#1A1A1A]/10 p-10 rounded-[2.5rem] shadow-2xl text-center max-w-sm"
                    >
                      <div className="w-20 h-20 bg-[#FF6321]/10 rounded-3xl flex items-center justify-center text-[#FF6321] mx-auto mb-6">
                        <Calendar className="w-10 h-10" />
                      </div>
                      <h3 className="text-3xl font-bold tracking-tight mb-3">Connect First</h3>
                      <p className="text-sm text-[#1A1A1A]/60 mb-8 leading-relaxed">
                        To extract and sync events, you need to connect your Google Calendar account.
                      </p>
                      <button 
                        onClick={handleConnect}
                        className="w-full bg-[#1A1A1A] text-white py-4 rounded-2xl font-bold hover:bg-[#333] transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-[10px] shadow-xl shadow-black/10"
                      >
                        <Calendar className="w-4 h-4" />
                        Connect Google Calendar
                      </button>
                    </motion.div>
                  </div>
                )}

                <div className={cn(
                  "flex flex-col gap-8 mb-20 transition-all duration-500",
                  !tokens && "opacity-30 grayscale-[0.8] pointer-events-none scale-[0.98]"
                )}>
                  <motion.div 
                    whileHover={{ scale: 1.01 }}
                    className="bg-white border border-[#1A1A1A]/10 p-8 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-500"
                  >
                    <div className="flex flex-col md:flex-row md:items-center gap-6">
                      <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 shrink-0">
                        <LinkIcon className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-1">From a Link</h3>
                        <p className="text-sm text-[#1A1A1A]/50 mb-4">Paste an event URL (Instagram, Eventbrite, etc.)</p>
                        <form onSubmit={handleUrlSubmit} className="flex gap-2">
                          <input 
                            type="url" 
                            placeholder="https://..."
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            className="flex-1 bg-[#F5F5F5] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FF6321] transition-all"
                          />
                          <button 
                            disabled={isExtracting || !url}
                            className="bg-[#1A1A1A] text-white px-6 rounded-xl disabled:opacity-50 hover:bg-[#333] transition-colors flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-wider"
                          >
                            {isExtracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                            <span className="hidden sm:inline">Extract Link</span>
                          </button>
                        </form>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ scale: 1.01 }}
                    className="bg-white border border-[#1A1A1A]/10 p-8 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-500"
                  >
                    <div className="flex flex-col md:flex-row md:items-start gap-6">
                      <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600 shrink-0">
                        <Type className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-1">From Text</h3>
                        <p className="text-sm text-[#1A1A1A]/50 mb-4">Paste event details directly</p>
                        <div className="flex flex-col sm:flex-row gap-4">
                          <textarea 
                            placeholder="Paste event details..."
                            value={rawText}
                            onChange={(e) => setRawText(e.target.value)}
                            className="flex-1 bg-[#F5F5F5] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FF6321] transition-all min-h-[100px] resize-none"
                          />
                          <button 
                            onClick={handleTextExtract}
                            disabled={isExtracting || !rawText.trim()}
                            className="sm:w-48 bg-[#1A1A1A] text-white py-3 rounded-xl disabled:opacity-50 hover:bg-[#333] transition-colors flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider"
                          >
                            {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Extract Text
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ scale: 1.01 }}
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-white border border-[#1A1A1A]/10 p-8 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-500 cursor-pointer group"
                  >
                    <div className="flex flex-col md:flex-row md:items-center gap-6">
                      <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600 shrink-0">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-1">Screenshot</h3>
                        <p className="text-sm text-[#1A1A1A]/50 mb-4">Upload or <b>press Ctrl+V (Cmd+V)</b> to paste directly</p>
                        <div className="flex flex-col sm:flex-row gap-4">
                          <div className="flex-1 border-2 border-dashed border-[#1A1A1A]/10 rounded-2xl py-6 flex flex-col items-center justify-center group-hover:border-[#FF6321]/30 transition-colors">
                            <Upload className="w-6 h-6 text-[#1A1A1A]/20 mb-2 group-hover:text-[#FF6321] transition-colors" />
                            <span className="text-xs font-medium text-[#1A1A1A]/40">Click to upload or paste image</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClipboardPaste();
                            }}
                            className="sm:w-48 bg-[#F5F5F5] hover:bg-[#EEEEEE] rounded-xl text-xs font-bold uppercase tracking-wider text-[#1A1A1A]/60 transition-colors flex items-center justify-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            Paste Clipboard
                          </button>
                        </div>
                      </div>
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="image/*"
                      className="hidden"
                    />
                  </motion.div>

                  <motion.div 
                    whileHover={{ scale: 1.01 }}
                    onClick={() => setShowManualForm(true)}
                    className="bg-white border border-[#1A1A1A]/10 p-8 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-500 cursor-pointer group"
                  >
                    <div className="flex flex-col md:flex-row md:items-center gap-6">
                      <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-600 shrink-0">
                        <Plus className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-1">Manual Entry</h3>
                        <p className="text-sm text-[#1A1A1A]/50 mb-4">Type the event details yourself if you don't have a source</p>
                        <div className="flex justify-end">
                          <div className="bg-[#F5F5F5] group-hover:bg-[#FF6321] group-hover:text-white px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-[#1A1A1A]/60 transition-all flex items-center gap-2">
                            <Plus className="w-4 h-4" />
                            Add Manually
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </div>

              {extractedEvents.length > 0 && (
                <div className="flex justify-center">
                  <button 
                    onClick={() => setCurrentView('review')}
                    className="bg-[#FF6321] text-white px-10 py-4 rounded-2xl font-bold hover:bg-[#E55A1E] transition-all shadow-xl shadow-[#FF6321]/20 flex items-center gap-2 group"
                  >
                    Review {extractedEvents.length} extracted events
                    <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="review"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="mb-12 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <button 
                  onClick={() => setCurrentView('source')}
                  className="flex items-center gap-2 text-[#1A1A1A]/60 hover:text-[#1A1A1A] transition-colors font-medium group"
                >
                  <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                  Back to sources
                </button>
                
                <div className="flex items-center gap-4">
                  <button 
                    onClick={handleSyncAll}
                    disabled={isSyncing || extractedEvents.length === 0}
                    className="bg-[#FF6321] text-white px-8 py-3 rounded-xl text-sm font-bold hover:bg-[#E55A1E] transition-all disabled:opacity-50 shadow-lg shadow-[#FF6321]/20 flex items-center gap-2"
                  >
                    {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Sync All to Calendar
                  </button>
                </div>
              </div>

              {/* Extracted Events List */}
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-3xl font-bold tracking-tight">
                    {extractedEvents.length > 0 ? "Review & Sync" : "No events to review"}
                  </h3>
                  {extractedEvents.length > 0 && (
                    <button 
                      onClick={() => {
                        if (window.confirm("Are you sure you want to clear the list?")) {
                          setExtractedEvents([]);
                          setCurrentView('source');
                        }
                      }}
                      className="text-sm text-red-500 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-4 h-4" /> Clear all
                    </button>
                  )}
                </div>

                <AnimatePresence mode="popLayout">
                  {extractedEvents.map((event, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white border border-[#1A1A1A]/10 rounded-[2rem] p-8 shadow-sm overflow-hidden relative"
                    >
                      <div className="flex flex-col md:flex-row gap-8">
                        <div className="flex-1">
                          <div className="flex items-start justify-between mb-6">
                            <div>
                              <h4 className="text-3xl font-bold tracking-tight mb-2">{event.name}</h4>
                              <p className="text-lg text-[#FF6321] font-medium italic font-serif">
                                {event.venue || "Venue not specified"}
                              </p>
                            </div>
                            <div className="bg-gray-50 px-4 py-2 rounded-2xl flex flex-col items-center justify-center min-w-[80px]">
                              <span className="text-xs uppercase tracking-widest font-bold text-gray-400">
                                {event.startDate ? format(parseISO(event.startDate), 'MMM') : '---'}
                              </span>
                              <span className="text-2xl font-bold leading-none">
                                {event.startDate ? format(parseISO(event.startDate), 'dd') : '--'}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-[#1A1A1A]/70">
                            <div className="flex items-center gap-3">
                              <MapPin className="w-4 h-4 text-[#1A1A1A]/30" />
                              <span>{event.address || "Address not specified"}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <Clock className="w-4 h-4 text-[#1A1A1A]/30" />
                              <span>{event.startTime ? `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}` : 'All Day'}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <DollarSign className="w-4 h-4 text-[#1A1A1A]/30" />
                              <span>{event.price || "Free / Not specified"}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <CalendarDays className="w-4 h-4 text-[#1A1A1A]/30" />
                              <span>{event.startDate} {event.endDate ? `to ${event.endDate}` : ''}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-3 justify-center md:w-48">
                          <button 
                            onClick={() => startEditing(index, event)}
                            className="bg-[#1A1A1A] text-white px-8 py-4 rounded-2xl font-bold hover:bg-[#333] transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                            Edit Details
                          </button>
                          <button 
                            onClick={() => {
                              const newEvents = extractedEvents.filter((_, i) => i !== index);
                              setExtractedEvents(newEvents);
                              if (newEvents.length === 0) setCurrentView('source');
                            }}
                            className="bg-[#F5F5F5] text-[#1A1A1A] px-8 py-4 rounded-2xl font-bold hover:bg-[#EEEEEE] transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                            Discard
                          </button>
                        </div>
                      </div>

                      {/* Status Overlay */}
                      <AnimatePresence>
                        {syncStatus && syncStatus.index === index && (
                          <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={cn(
                              "absolute inset-0 flex items-center justify-center backdrop-blur-sm z-10",
                              syncStatus.success ? "bg-green-500/10" : "bg-red-500/10"
                            )}
                          >
                            <div className={cn(
                              "px-6 py-3 rounded-full font-bold text-sm shadow-xl flex items-center gap-2",
                              syncStatus.success ? "bg-green-500 text-white" : "bg-red-500 text-white"
                            )}>
                              {syncStatus.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                              {syncStatus.message}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1A1A1A]/10 py-12 px-6 text-center text-sm text-[#1A1A1A]/40">
        <p>© 2026 Event2Calendar AI. Powered by Google Gemini.</p>
        <div className="flex justify-center gap-6 mt-4">
          <a href="#" className="hover:text-[#1A1A1A] transition-colors">Privacy</a>
          <a href="#" className="hover:text-[#1A1A1A] transition-colors">Terms</a>
          <a href="#" className="hover:text-[#1A1A1A] transition-colors">Support</a>
        </div>
      </footer>

      {/* Manual Event Modal */}
      <AnimatePresence>
        {showManualForm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#1A1A1A]/40 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeManualForm();
            }}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 sm:p-12">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-bold tracking-tight">
                    {editingIndex !== null ? 'Edit Event' : 'Add Event Manually'}
                  </h2>
                  <button 
                    onClick={closeManualForm}
                    className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleManualSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">Event Name</label>
                      <input 
                        required
                        className="w-full px-6 py-4 bg-[#F5F5F5] rounded-2xl border-none focus:ring-2 focus:ring-[#FF6321] transition-all font-medium"
                        value={manualEvent.name}
                        onChange={e => setManualEvent({...manualEvent, name: e.target.value})}
                        placeholder="e.g. King Kong Kicks"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">Venue (Optional)</label>
                      <input 
                        className="w-full px-6 py-4 bg-[#F5F5F5] rounded-2xl border-none focus:ring-2 focus:ring-[#FF6321] transition-all font-medium"
                        value={manualEvent.venue}
                        onChange={e => setManualEvent({...manualEvent, venue: e.target.value})}
                        placeholder="e.g. Milla Club"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">Address (Optional)</label>
                      <input 
                        className="w-full px-6 py-4 bg-[#F5F5F5] rounded-2xl border-none focus:ring-2 focus:ring-[#FF6321] transition-all font-medium"
                        value={manualEvent.address}
                        onChange={e => setManualEvent({...manualEvent, address: e.target.value})}
                        placeholder="e.g. Holzstraße 28"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">Start Date</label>
                      <input 
                        type="date"
                        required
                        className="w-full px-6 py-4 bg-[#F5F5F5] rounded-2xl border-none focus:ring-2 focus:ring-[#FF6321] transition-all font-medium"
                        value={manualEvent.startDate}
                        onChange={e => setManualEvent({...manualEvent, startDate: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/40 mb-2">Start Time (Optional)</label>
                      <input 
                        type="time"
                        className="w-full px-6 py-4 bg-[#F5F5F5] rounded-2xl border-none focus:ring-2 focus:ring-[#FF6321] transition-all font-medium"
                        value={manualEvent.startTime}
                        onChange={e => setManualEvent({...manualEvent, startTime: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button 
                      type="button"
                      onClick={closeManualForm}
                      className="flex-1 px-8 py-4 rounded-2xl font-bold bg-gray-100 hover:bg-gray-200 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-1 px-8 py-4 rounded-2xl font-bold bg-[#FF6321] text-white hover:bg-[#E55A1E] transition-all shadow-xl shadow-[#FF6321]/20"
                    >
                      {editingIndex !== null ? 'Update Event' : 'Add Event'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
