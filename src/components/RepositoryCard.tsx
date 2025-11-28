import { Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export const RepositoryCard = () => {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Upload documents</CardTitle>
        <CardDescription>
          Add PDFs, Word files, or text documents to build your knowledge base.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Area */}
        <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer">
          <input
            type="file"
            id="file-upload"
            multiple
            accept=".pdf,.docx,.txt"
            className="hidden"
          />
          <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-3">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, DOCX, or TXT files
              </p>
            </div>
          </label>
        </div>

        <Separator />

        {/* Metadata Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="doc-type">Document type</Label>
            <Select>
              <SelectTrigger id="doc-type">
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="report">Daily / shift report</SelectItem>
                <SelectItem value="procedure">Procedure / SOP</SelectItem>
                <SelectItem value="project">Project document</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="equipment-type">Equipment type</Label>
            <Select>
              <SelectTrigger id="equipment-type">
                <SelectValue placeholder="Select equipment type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inverter">Inverter</SelectItem>
                <SelectItem value="battery">Battery</SelectItem>
                <SelectItem value="converter">Converter</SelectItem>
                <SelectItem value="pcs">PCS</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            placeholder="Short description, e.g. 'XG-4000 inverter commissioning logs for Site-23'."
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Build Button */}
        <div className="flex justify-end">
          <Button size="lg">Build knowledge base</Button>
        </div>
      </CardContent>
    </Card>
  );
};
