// État partagé minimal
import { api } from './api.js';

// À incrémenter avec VERSION dans sw.js à chaque mise en ligne
export const APP_VERSION = '2.8.0';

export const store = {
  categories: [],
  status: { configured: false },
  async loadCategories() { this.categories = await api.categories(); return this.categories; },
  async refreshStatus() { this.status = await api.status(); return this.status; },
  catName(id) { return this.categories.find((c) => c.id === id)?.name || ''; },
};

// Couleurs et matières proposées pour personnaliser un meuble
export const COLORS = [
  { name: 'Blanc', hex: '#f4f2ee' }, { name: 'Ivoire', hex: '#ece3cf' }, { name: 'Beige lin', hex: '#d8c8ad' },
  { name: 'Taupe', hex: '#9b8b7a' }, { name: 'Gris perle', hex: '#c4c4c2' }, { name: 'Gris anthracite', hex: '#4a4c50' },
  { name: 'Noir', hex: '#1d1d1d' }, { name: 'Bleu nuit', hex: '#1f2f4f' }, { name: 'Bleu canard', hex: '#1f5c66' },
  { name: 'Vert sauge', hex: '#9aa88a' }, { name: 'Vert forêt', hex: '#2f4a3a' }, { name: 'Terracotta', hex: '#b5603f' },
  { name: 'Moutarde', hex: '#c9a03a' }, { name: 'Rose poudré', hex: '#d9b3a8' }, { name: 'Cognac', hex: '#8a4f2a' },
  { name: 'Chêne clair', hex: '#c9a679' }, { name: 'Noyer', hex: '#6b4a32' },
];

export const TEXTURES = [
  { name: 'Tissu tissé', css: 'repeating-linear-gradient(0deg,#cfc6b8 0 2px,#ddd5c8 2px 4px),#ddd5c8' },
  { name: 'Velours', css: 'linear-gradient(135deg,#7c86a3,#4c5677 60%,#7c86a3)' },
  { name: 'Bouclette', css: 'radial-gradient(circle at 3px 3px,#fff 1.5px,#e6e0d6 2px) 0 0/6px 6px' },
  { name: 'Lin', css: 'repeating-linear-gradient(90deg,#d9cfbd 0 1px,#e7dfd0 1px 3px),#e7dfd0' },
  { name: 'Cuir', css: 'radial-gradient(circle at 30% 30%,#a0673f,#6e4024)' },
  { name: 'Cuir vieilli', css: 'linear-gradient(120deg,#7a4a2a,#a46d45 40%,#5f381f)' },
  { name: 'Bois chêne', css: 'repeating-linear-gradient(100deg,#c9a679 0 6px,#b89062 6px 8px,#d1b085 8px 14px)' },
  { name: 'Bois noyer', css: 'repeating-linear-gradient(100deg,#6b4a32 0 6px,#5a3d29 6px 8px,#76533a 8px 14px)' },
  { name: 'Laqué mat', css: '#e9e7e3' },
  { name: 'Laqué brillant', css: 'linear-gradient(160deg,#fff,#dcdcdc 45%,#fafafa 55%,#d5d5d5)' },
  { name: 'Marbre', css: 'linear-gradient(125deg,#f2f2f0 30%,#cfcfcf 32%,#f2f2f0 35%,#f2f2f0 60%,#bdbdbd 62%,#f2f2f0 64%)' },
  { name: 'Céramique', css: 'linear-gradient(135deg,#8f8a84,#b5afa7)' },
  { name: 'Métal brossé', css: 'repeating-linear-gradient(90deg,#b8bcc0 0 1px,#cfd3d6 1px 3px)' },
  { name: 'Verre', css: 'linear-gradient(135deg,rgba(180,210,220,.6),rgba(255,255,255,.9))' },
  { name: 'Rotin / cannage', css: 'repeating-linear-gradient(45deg,#c8a46e 0 2px,transparent 2px 6px),repeating-linear-gradient(-45deg,#c8a46e 0 2px,#efe2c8 2px 6px)' },
];

// Matières en anglais pour le prompt (meilleure compréhension par le modèle)
export const TEXTURE_EN = {
  'Tissu tissé': 'woven fabric upholstery', 'Velours': 'velvet', 'Bouclette': 'bouclé fabric', 'Lin': 'linen fabric',
  'Cuir': 'smooth leather', 'Cuir vieilli': 'aged / distressed leather', 'Bois chêne': 'natural oak wood', 'Bois noyer': 'walnut wood',
  'Laqué mat': 'matte lacquer', 'Laqué brillant': 'high-gloss lacquer', 'Marbre': 'marble', 'Céramique': 'ceramic',
  'Métal brossé': 'brushed metal', 'Verre': 'glass', 'Rotin / cannage': 'rattan cane webbing',
};

// Types pour lesquels on affiche hauteur d'assise / de plateau
export const SEAT_TYPES = /canap|fauteuil|chaise|tabouret|banc|pouf|méridienne/i;
export const TOP_TYPES = /table|bureau|console|îlot|desserte|coiffeuse|buffet|commode|chevet/i;
