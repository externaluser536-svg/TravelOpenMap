import {
  Activity, Award, Bed, Binoculars, Bookmark, Calendar, Camera, ChartColumn, Check, ChevronLeft, ChevronRight, Clapperboard, Clock,
  Cloud, Compass, Crosshair, Crown, Database, Download, Eye, EyeOff, Flame, Footprints, Gauge, Globe, HardDrive, Images, Info,
  Landmark, Languages, Layers, Library, Lightbulb, LocateFixed, LocateOff, Map, MapPin, MapPinned, Medal, Moon, Mountain,
  Navigation, Notebook, Palette, Pencil, Play, Plus, Rocket, Route, Ruler, Search, Settings, Share2, Shield, ShieldCheck, Sparkles,
  Square, Sun, Sunrise, Target, Telescope, Trash2, Trees, Trophy, Train, TriangleAlert, Undo2, Upload, User, Utensils, Video, Wifi,
  WifiOff, X, Zap, Ban, Image, Film, ListChecks, Vibrate, PartyPopper, Star, Tag, Smartphone,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type IconC = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

const ICONS: Record<string, IconC> = {
  activity: Activity, award: Award, bed: Bed, binoculars: Binoculars, bookmark: Bookmark, calendar: Calendar, camera: Camera,
  chart: ChartColumn, check: Check, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, clapperboard: Clapperboard,
  clock: Clock, cloud: Cloud, compass: Compass, crosshair: Crosshair, crown: Crown, database: Database, download: Download,
  eye: Eye, 'eye-off': EyeOff, flame: Flame, footprints: Footprints, gauge: Gauge, globe: Globe, 'hard-drive': HardDrive,
  images: Images, info: Info, landmark: Landmark, languages: Languages, layers: Layers, library: Library, lightbulb: Lightbulb,
  locate: LocateFixed, 'locate-off': LocateOff, map: Map, pin: MapPin, 'map-pinned': MapPinned, medal: Medal, moon: Moon,
  mountain: Mountain, navigation: Navigation, notebook: Notebook, palette: Palette, pencil: Pencil, play: Play, plus: Plus,
  rocket: Rocket, route: Route, ruler: Ruler, search: Search, settings: Settings, share: Share2, shield: Shield,
  'shield-check': ShieldCheck, sparkles: Sparkles, square: Square, sun: Sun, sunrise: Sunrise, target: Target,
  telescope: Telescope, trash: Trash2, trees: Trees, trophy: Trophy, train: Train, 'triangle-alert': TriangleAlert, undo: Undo2,
  upload: Upload, user: User, utensils: Utensils, video: Video, wifi: Wifi, 'wifi-off': WifiOff, x: X, zap: Zap, ban: Ban,
  image: Image, film: Film, list: ListChecks, vibrate: Vibrate, party: PartyPopper, star: Star, tag: Tag, phone: Smartphone,
};

export function Icon({ name, size = 20, strokeWidth = 2, ...rest }: { name: string; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const C = ICONS[name] ?? MapPin;
  return <C size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />;
}
