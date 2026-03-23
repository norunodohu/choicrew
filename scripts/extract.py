from pathlib import Path
path = Path('C:/Users/murat/Desktop/project/choicrew/src/App.tsx')
data = path.read_text(encoding='utf-8')
start = data.index('\n  if (isPublicView && publicUser) {') + 1
end_marker = '\n  return (\n    <div className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans"'
end = data.index(end_marker)
print(start)
print(end)
print(data[start:end])
