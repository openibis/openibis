import sys
from youtube_transcript_api import YouTubeTranscriptApi
api=YouTubeTranscriptApi()
print(" ".join([x.text for x in api.fetch(sys.argv[1])])[:5000])
