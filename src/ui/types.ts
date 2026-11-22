// The stacks the UI shows, as stored in src/ui/stacks.json, in autosave and in save files.
// Plain data, so a deep copy is JSON.parse(JSON.stringify(x)).

/** x, y, width, height in card pixels (the card is 512×342). */
export type Rect = [number, number, number, number];

export interface FieldDoc {
  id: string;
  name: string;
  text: string;
  rect: Rect;
  visible: boolean;
  /** 'plain' is text on the card; 'box' draws a HyperCard rectangle field around it. */
  style: 'plain' | 'box' | 'title';
  align?: 'left' | 'center';
}

export interface ButtonDoc {
  id: string;
  name: string;
  rect: Rect;
  visible: boolean;
  /** The plain-language sentence this script came from. */
  sentence: string;
  script: string;
  /** 'roundrect' is the HyperCard button with a pumpkin; 'icon' is a Home stack icon. */
  style: 'roundrect' | 'icon';
  /** Pixel art drawn on an icon button. */
  icon?: string;
}

export interface CardDoc {
  id: string;
  name: string;
  script: string;
  /** Pixel art drawn behind the card's fields and buttons. */
  art?: string;
  fields: FieldDoc[];
  buttons: ButtonDoc[];
}

export interface StackDoc {
  id: string;
  name: string;
  cards: CardDoc[];
}

export interface StacksDoc {
  stacks: StackDoc[];
}
