#!/bin/bash

# Check if rsvg-convert is available
if ! command -v rsvg-convert &> /dev/null; then
    echo "Error: rsvg-convert is not installed. Please install librsvg2-bin package."
    exit 1
fi

# Create titlebuttons2 directory if it doesn't exist
mkdir -p titlebuttons2

# Counter for processed files
count=0

# Process all SVG files in current directory
for svg_file in *.svg; do
    # Skip if no SVG files found
    if [[ ! -f "$svg_file" ]]; then
        echo "No SVG files found in current directory"
        exit 1
    fi
    
    # Get filename without extension
    basename="${svg_file%.svg}"
    
    # Convert to 16px PNG (standard resolution)
    echo "Converting $svg_file to 16px PNG..."
    rsvg-convert -w 16 -h 16 "$svg_file" -o "titlebuttons2/${basename}.png"
    
    # Convert to 32px PNG (hi-DPI @2 version)
    echo "Converting $svg_file to 32px @2 PNG..."
    rsvg-convert -w 32 -h 32 "$svg_file" -o "titlebuttons2/${basename}@2.png"
    
    ((count++))
done

echo ""
echo "✅ Conversion complete!"
echo "📊 Processed $count SVG files"
echo "📁 Output directory: titlebuttons2/"
echo ""
echo "Generated files:"
ls -la titlebuttons2/ | grep -E '\.(png)$'
