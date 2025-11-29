import { Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SearchResult {
  fileName: string;
  snippet: string;
  position: number;
  equipment?: string;
}

export const AssistantCard = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();
  const handleSearch = async () => {
    if (!query.trim()) {
      toast({
        title: "Error",
        description: "Please enter a search query",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setHasSearched(true);

    try {
      const { data, error } = await supabase.functions.invoke('search', {
        body: { query: query.trim() },
      });

      if (error) throw error;

      if (data.success) {
        setResults(data.results || []);
        toast({
          title: "Search complete",
          description: `Found ${data.count} result${data.count !== 1 ? 's' : ''}`,
        });
      } else {
        throw new Error(data.error || 'Search failed');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: "Search failed",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: "destructive",
      });
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const highlightQuery = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="bg-yellow-200 dark:bg-yellow-900/50 font-semibold">
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Search documents</CardTitle>
        <CardDescription>
          Search for keywords in your uploaded documents.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-4 pt-6">
        {/* Search Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Enter search query..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            disabled={isSearching}
          />
          <Button 
            onClick={handleSearch} 
            disabled={isSearching || !query.trim()}
          >
            <Search className="h-4 w-4" />
            Search
          </Button>
        </div>

        {/* Results Area */}
        <ScrollArea className="h-[400px] rounded-lg border border-border bg-muted/30 p-4">
          {!hasSearched ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Enter a search query to find matching text in your documents
            </div>
          ) : results.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No results found. Please ingest documents first or try a different query.
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((result, index) => (
                <div key={index} className="bg-card border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {result.fileName}
                    </Badge>
                    {result.equipment && (
                      <Badge variant="secondary" className="text-xs">
                        {result.equipment}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">
                    {highlightQuery(result.snippet, query)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
