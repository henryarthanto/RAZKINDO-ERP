'use client';

import { useEffect, useRef } from 'react';

/**
 * Dynamically updates the browser favicon to match the company logo.
 * Falls back to the default /logo.svg when no custom logo is set.
 */
export function useDynamicFavicon(logoDataUrl?: string) {
  const prevLogoRef = useRef<string | null>(null);

  useEffect(() => {
    if (logoDataUrl === prevLogoRef.current) return;
    prevLogoRef.current = logoDataUrl || null;

    // Find or create the favicon <link> element
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }

    // Convert base64 data URL to an ICO-compatible data URL
    if (logoDataUrl) {
      // Detect mime type from the data URL
      const mimeMatch = logoDataUrl.match(/data:(image\/\w+);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/png';
      link.type = mime;

      // For SVG logos, use as-is
      if (mime === 'image/svg+xml') {
        link.href = logoDataUrl;
      } else {
        // For raster images (PNG, JPG, etc.), create a canvas to resize to 32x32
        const img = document.createElement('img');
        // BUG FIX: Add onerror handler for corrupted/invalid images
        img.onerror = () => {
          // Fallback to default logo if image fails to load
          link.type = 'image/svg+xml';
          link.href = '/logo.svg';
        };
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Draw with rounded corners
            const size = 32;
            const radius = 6;
            ctx.clearRect(0, 0, size, size);
            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(size - radius, 0);
            ctx.quadraticCurveTo(size, 0, size, radius);
            ctx.lineTo(size, size - radius);
            ctx.quadraticCurveTo(size, size, size - radius, size);
            ctx.lineTo(radius, size);
            ctx.quadraticCurveTo(0, size, 0, size - radius);
            ctx.lineTo(0, radius);
            ctx.quadraticCurveTo(0, 0, radius, 0);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, 0, 0, size, size);

            // BUG FIX: Always use PNG to preserve transparency
            link.type = 'image/png';
            link.href = canvas.toDataURL('image/png');
          }
        };
        img.src = logoDataUrl;
      }
    } else {
      // Fallback to default logo
      link.type = 'image/svg+xml';
      link.href = '/logo.svg';
    }
  }, [logoDataUrl]);
}
