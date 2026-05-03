'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface CircularGaugeProps {
  /** Percentage value (0-100) */
  value: number;
  /** Label displayed below the gauge */
  label: string;
  /** Sub-label with additional detail */
  detail?: string;
  /** Size in pixels */
  size?: number;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Custom color thresholds: [greenThreshold, yellowThreshold] — above greenThreshold = green, above yellowThreshold = yellow, else red */
  thresholds?: [number, number];
  /** Whether lower values are better (e.g., HPP ratio) — inverts the color logic */
  invertColors?: boolean;
  /** Icon to show */
  icon?: React.ReactNode;
}

/**
 * Circular SVG Gauge component — a speedometer-style arc gauge.
 * Animates smoothly when value changes using CSS transitions.
 * Color coding: green (good), yellow (warning), red (bad).
 */
export default function CircularGauge({
  value,
  label,
  detail,
  size = 120,
  strokeWidth = 8,
  thresholds = [70, 40],
  invertColors = false,
  icon,
}: CircularGaugeProps) {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    // Animate from current to new value
    const timer = setTimeout(() => {
      setAnimatedValue(Math.min(Math.max(value, 0), 100));
    }, 50);
    return () => clearTimeout(timer);
  }, [value]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Arc is 270 degrees (3/4 of circle) — like a speedometer
  const arcLength = circumference * 0.75;
  const dashOffset = arcLength - (arcLength * animatedValue) / 100;
  const center = size / 2;

  // Determine color based on thresholds
  let colorClass: string;
  let strokeColor: string;
  let bgColor: string;

  if (invertColors) {
    // For metrics where lower is better (e.g., HPP ratio)
    if (animatedValue <= thresholds[1]) {
      // Low value = good (green)
      colorClass = 'text-emerald-600 dark:text-emerald-400';
      strokeColor = '#10b981'; // emerald-500
      bgColor = '#d1fae5'; // emerald-100
    } else if (animatedValue <= thresholds[0]) {
      // Medium value = warning (yellow)
      colorClass = 'text-amber-600 dark:text-amber-400';
      strokeColor = '#f59e0b'; // amber-500
      bgColor = '#fef3c7'; // amber-100
    } else {
      // High value = bad (red)
      colorClass = 'text-red-600 dark:text-red-400';
      strokeColor = '#ef4444'; // red-500
      bgColor = '#fee2e2'; // red-100
    }
  } else {
    // For metrics where higher is better (e.g., profit margin, collection rate)
    if (animatedValue >= thresholds[0]) {
      // High value = good (green)
      colorClass = 'text-emerald-600 dark:text-emerald-400';
      strokeColor = '#10b981';
      bgColor = '#d1fae5';
    } else if (animatedValue >= thresholds[1]) {
      // Medium value = warning (yellow)
      colorClass = 'text-amber-600 dark:text-amber-400';
      strokeColor = '#f59e0b';
      bgColor = '#fef3c7';
    } else {
      // Low value = bad (red)
      colorClass = 'text-red-600 dark:text-red-400';
      strokeColor = '#ef4444';
      bgColor = '#fee2e2';
    }
  }

  // Rotation: start from bottom-left (135deg) to make it look like a speedometer
  const rotation = 135;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {/* Background arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={bgColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={0}
          />
          {/* Value arc — animated */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={dashOffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ transform: 'none' }}>
          {icon && <div className="mb-0.5">{icon}</div>}
          <span className={cn('text-lg font-bold tabular-nums', colorClass)}>
            {animatedValue.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="text-center min-w-0">
        <p className="text-xs font-medium truncate max-w-[120px]">{label}</p>
        {detail && (
          <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{detail}</p>
        )}
      </div>
    </div>
  );
}
